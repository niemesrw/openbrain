import { CognitoJwtVerifier } from "aws-jwt-verify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { UserContext } from "../types";

const USER_POOL_ID = process.env.USER_POOL_ID!;
const AGENT_KEYS_TABLE = process.env.AGENT_KEYS_TABLE!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Accept tokens from any client in the user pool (supports DCR-created clients).
// Verify both id and access tokens — MCP OAuth clients send access tokens,
// while existing web/cli clients send id tokens.
const idTokenVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "id",
  clientId: null, // accept tokens from any client in the pool (DCR clients have dynamic IDs)
});

const accessTokenVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "access",
  clientId: null, // accept tokens from any client in the pool (DCR clients have dynamic IDs)
});

/**
 * Decode a JWT payload without verification to read the token_use claim.
 */
function decodeTokenUse(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload.token_use;
  } catch {
    return undefined;
  }
}

/**
 * Verify a request's auth credentials and return user context.
 * Tries JWT (Bearer token) first, then falls back to API key.
 * Throws if neither succeeds.
 */
export async function verifyAuth(headers: Record<string, string | undefined>): Promise<UserContext> {
  // Try JWT (Bearer token) first
  const authHeader = headers.authorization || headers.Authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // Decode token_use to pick the right verifier without a failed verification attempt
    const tokenUse = decodeTokenUse(token);

    try {
      if (tokenUse === "access") {
        const payload = await accessTokenVerifier.verify(token);
        return {
          userId: payload.sub,
          cognitoUsername: (payload as any).username || undefined,
          displayName: (payload as any).username || undefined,
        };
      } else {
        // Default to id token (covers id tokens and unknown token_use)
        const payload = await idTokenVerifier.verify(token);
        return {
          userId: payload.sub,
          cognitoUsername: (payload as any)["cognito:username"] || undefined,
          displayName: (payload as any).preferred_username || undefined,
        };
      }
    } catch {
      // JWT verification failed — fall through to API key
    }
  }

  // Try API key
  const apiKey = headers["x-api-key"] || headers["X-Api-Key"];
  if (apiKey?.startsWith("ob_")) {
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
        userId: item.userId,
        agentName: item.agentName,
        displayName: item.displayName,
      };
    }
  }

  throw new Error("Unauthorized");
}
