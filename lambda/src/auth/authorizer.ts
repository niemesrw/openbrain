import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLI_CLIENT_ID = process.env.CLI_CLIENT_ID!;
const WEB_CLIENT_ID = process.env.WEB_CLIENT_ID!;
const AGENT_KEYS_TABLE = process.env.AGENT_KEYS_TABLE!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Verify ID tokens (not access tokens) so we get preferred_username claim
const jwtVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "id",
  clientId: [CLI_CLIENT_ID, WEB_CLIENT_ID],
});

interface AuthContext {
  userId: string;
  agentName?: string;
  displayName?: string;
}

export async function handler(
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthContext>> {
  const unauthorized = {
    isAuthorized: false as const,
    context: { userId: "" },
  };

  // Try JWT (Bearer token) first
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = await jwtVerifier.verify(token);
      return {
        isAuthorized: true,
        context: {
          userId: payload.sub,
          displayName: (payload as any).preferred_username || undefined,
        },
      };
    } catch {
      // Invalid JWT — fall through to API key check
    }
  }

  // Try API key
  const apiKey =
    event.headers?.["x-api-key"] || event.headers?.["X-Api-Key"];
  if (apiKey?.startsWith("ob_")) {
    try {
      const result = await ddb.send(
        new QueryCommand({
          TableName: AGENT_KEYS_TABLE,
          IndexName: "api-key-index",
          KeyConditionExpression: "apiKey = :key",
          ExpressionAttributeValues: { ":key": apiKey },
          Limit: 1,
        })
      );

      const item = result.Items?.[0];
      if (item) {
        return {
          isAuthorized: true,
          context: {
            userId: item.userId,
            agentName: item.agentName,
            displayName: item.displayName,
          },
        };
      }
    } catch {
      // DynamoDB error — deny
    }
  }

  return unauthorized;
}
