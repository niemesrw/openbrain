import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { UserContext } from "../types";

export function extractUserContext(event: APIGatewayProxyEventV2): UserContext {
  const ctx = (event.requestContext as any).authorizer?.lambda;
  if (!ctx?.userId) throw new Error("Unauthorized");

  return {
    userId: ctx.userId,
    agentName: ctx.agentName || undefined,
    displayName: ctx.displayName || undefined,
  };
}
