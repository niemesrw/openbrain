import { randomBytes } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CreateAgentArgs, RevokeAgentArgs, UserContext } from "../types";

const AGENT_KEYS_TABLE = process.env.AGENT_KEYS_TABLE!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handleCreateAgent(
  args: CreateAgentArgs,
  user: UserContext
): Promise<string> {
  const { name } = args;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return "Error: Agent name must be alphanumeric (hyphens and underscores allowed).";
  }

  const apiKey = `ob_${randomBytes(32).toString("hex")}`;
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: AGENT_KEYS_TABLE,
      Item: {
        pk: `USER#${user.userId}`,
        sk: `AGENT#${name}`,
        apiKey,
        userId: user.userId,
        agentName: name,
        displayName: user.displayName,
        createdAt: now,
      },
      ConditionExpression: "attribute_not_exists(pk)",
    })
  );

  const apiUrl = process.env.API_URL || "<your-api-url>";

  return [
    `Agent "${name}" created.`,
    "",
    `API Key: ${apiKey}`,
    "",
    "MCP config for Claude Code:",
    `  claude mcp add --transport http open-brain ${apiUrl}/mcp --header "x-api-key: ${apiKey}"`,
    "",
    "MCP config for Claude Desktop / other clients:",
    JSON.stringify(
      {
        "open-brain": {
          transport: "http",
          url: `${apiUrl}/mcp`,
          headers: { "x-api-key": apiKey },
        },
      },
      null,
      2
    ),
  ].join("\n");
}

export async function handleListAgents(user: UserContext): Promise<string> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: AGENT_KEYS_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `USER#${user.userId}` },
    })
  );

  const items = result.Items ?? [];
  if (items.length === 0) {
    return "No agents registered. Use create_agent to create one.";
  }

  const lines = items.map(
    (item) => `- ${item.agentName} (created ${item.createdAt})`
  );
  return [`${items.length} agent(s):`, ...lines].join("\n");
}

export async function handleRevokeAgent(
  args: RevokeAgentArgs,
  user: UserContext
): Promise<string> {
  await ddb.send(
    new DeleteCommand({
      TableName: AGENT_KEYS_TABLE,
      Key: {
        pk: `USER#${user.userId}`,
        sk: `AGENT#${args.name}`,
      },
    })
  );

  return `Agent "${args.name}" revoked. Its API key will stop working shortly.`;
}
