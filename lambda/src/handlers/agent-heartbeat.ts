import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { AgentHeartbeatArgs, UserContext } from "../types";

const AGENT_KEYS_TABLE = process.env.AGENT_KEYS_TABLE!;
const ddb = new DynamoDBClient({});

export async function handleAgentHeartbeat(
  args: AgentHeartbeatArgs,
  user: UserContext
): Promise<string> {
  const { status, message } = args;

  if (!["idle", "working", "error"].includes(status)) {
    return `Error: status must be one of idle, working, or error.`;
  }

  if (!user.agentName) {
    return "Error: heartbeat requires an agent API key (not a user token).";
  }

  const now = new Date().toISOString();

  const expressionParts = [
    "lastSeen = :lastSeen",
    "#status = :status",
  ];
  const expressionNames: Record<string, string> = { "#status": "status" };
  const expressionValues: Record<string, { S: string } | { NULL: boolean }> = {
    ":lastSeen": { S: now },
    ":status": { S: status },
  };

  if (message !== undefined && message !== null) {
    expressionParts.push("statusMessage = :statusMessage");
    expressionValues[":statusMessage"] = { S: message };
  }

  await ddb.send(
    new UpdateItemCommand({
      TableName: AGENT_KEYS_TABLE,
      Key: {
        pk: { S: `USER#${user.userId}` },
        sk: { S: `AGENT#${user.agentName}` },
      },
      UpdateExpression: `SET ${expressionParts.join(", ")}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
    })
  );

  return `Heartbeat recorded: ${status}${message ? ` — ${message}` : ""}`;
}
