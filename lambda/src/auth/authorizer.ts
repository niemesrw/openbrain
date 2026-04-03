import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { verifyAuth } from "./verify";

interface AuthContext {
  userId: string;
  agentName?: string;
  displayName?: string;
}

export async function handler(
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthContext>> {
  try {
    const user = await verifyAuth(event.headers ?? {});
    return {
      isAuthorized: true,
      context: {
        userId: user.userId,
        agentName: user.agentName,
        displayName: user.displayName,
      },
    };
  } catch {
    return {
      isAuthorized: false,
      context: { userId: "" },
    };
  }
}
