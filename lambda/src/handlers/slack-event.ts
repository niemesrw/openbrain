import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { UserContext } from "../types";

const SLACK_INSTALLATIONS_TABLE = process.env.SLACK_INSTALLATIONS_TABLE!;
const SLACK_DEFERRED_FUNCTION_NAME = process.env.SLACK_DEFERRED_FUNCTION_NAME!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

interface SlackInstallationRecord {
  teamId: string;
  userId: string;
  slackUserId: string;
  accessToken: string;
  botUserId: string;
  teamName: string;
}

/**
 * Look up the Open Brain installation for a specific Slack user in a workspace.
 * Uses the team-slack-user-index GSI so each user gets their own brain context.
 */
async function getInstallation(
  teamId: string,
  slackUserId: string
): Promise<SlackInstallationRecord | null> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: SLACK_INSTALLATIONS_TABLE,
      IndexName: "team-slack-user-index",
      KeyConditionExpression: "teamId = :teamId AND slackUserId = :slackUserId",
      ExpressionAttributeValues: { ":teamId": teamId, ":slackUserId": slackUserId },
      Limit: 1,
    })
  );
  return (result.Items?.[0] as SlackInstallationRecord | undefined) ?? null;
}

function buildUserContext(userId: string): UserContext {
  return { userId };
}

function slashResponse(text: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
  };
}

/**
 * Invoke the deferred Lambda asynchronously (InvocationType: Event).
 * Lambda freezes the execution context once the handler returns, so brain
 * work must run in a separate invocation rather than a void IIFE.
 */
async function invokeDeferred(payload: Record<string, unknown>): Promise<void> {
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: SLACK_DEFERRED_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: JSON.stringify(payload),
    })
  );
}

async function handleSlashCommand(
  payload: Record<string, unknown>
): Promise<APIGatewayProxyResultV2> {
  // Only handle /brain — ignore other slash commands
  if (payload.command !== "/brain") {
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  const teamId = payload.team_id as string | undefined;
  const slackUserId = payload.user_id as string | undefined;
  const responseUrl = payload.response_url as string | undefined;
  const text = ((payload.text as string) ?? "").trim();

  if (!teamId || !slackUserId) {
    return slashResponse("Missing team or user ID.");
  }

  if (!responseUrl) {
    return slashResponse("Slack did not provide a response URL. Please try running `/brain` again.");
  }

  const installation = await getInstallation(teamId, slackUserId);
  if (!installation) {
    return slashResponse(
      "Your Slack account isn't linked to Open Brain yet. Connect at brain.blanxlait.ai → Settings."
    );
  }

  const user = buildUserContext(installation.userId);
  const [subcommand, ...rest] = text.split(/\s+/);
  const args = rest.join(" ").trim();

  if (!subcommand || subcommand === "help") {
    return slashResponse(
      "Open Brain commands:\n• `/brain search <query>` — search your brain\n• `/brain capture <thought>` — save a thought to your brain"
    );
  }

  if (subcommand === "search") {
    if (!args) return slashResponse("Usage: `/brain search <query>`");
    try {
      await invokeDeferred({ type: "slash_search", query: args, userId: user.userId, responseUrl });
    } catch (err) {
      console.error("[slack-event] Failed to invoke deferred search:", err instanceof Error ? err.message : String(err));
      return slashResponse("Something went wrong starting your search. Please try again.");
    }
    return slashResponse("Searching your brain…");
  }

  if (subcommand === "capture") {
    if (!args) return slashResponse("Usage: `/brain capture <thought>`");
    try {
      await invokeDeferred({ type: "slash_capture", text: args, userId: user.userId, responseUrl });
    } catch (err) {
      console.error("[slack-event] Failed to invoke deferred capture:", err instanceof Error ? err.message : String(err));
      return slashResponse("Something went wrong capturing your thought. Please try again.");
    }
    return slashResponse("Capturing your thought…");
  }

  // Treat unrecognized text as a search query
  try {
    await invokeDeferred({ type: "slash_search", query: text, userId: user.userId, responseUrl });
  } catch (err) {
    console.error("[slack-event] Failed to invoke deferred search:", err instanceof Error ? err.message : String(err));
    return slashResponse("Something went wrong starting your search. Please try again.");
  }
  return slashResponse("Searching your brain…");
}

async function handleDmMessage(
  payload: Record<string, unknown>,
  event: Record<string, unknown>
): Promise<void> {
  const teamId = payload.team_id as string | undefined;
  const channel = event.channel as string | undefined;
  const text = ((event.text as string) ?? "").trim();
  const slackUserId = event.user as string | undefined;

  if (!teamId || !channel || !text || !slackUserId) return;

  const installation = await getInstallation(teamId, slackUserId);
  if (!installation) return; // user hasn't connected — silently ignore

  await invokeDeferred({
    type: "dm_message",
    text,
    userId: installation.userId,
    accessToken: installation.accessToken,
    channel,
  });
}

export async function handleSlackEvent(
  payload: Record<string, unknown>
): Promise<APIGatewayProxyResultV2> {
  try {
    if (payload.type === "slash_command") {
      return await handleSlashCommand(payload);
    }

    if (payload.type === "event_callback") {
      const event = ((payload.event ?? {}) as Record<string, unknown>);
      if (event.type === "message" && event.channel_type === "im" && !event.bot_id) {
        await handleDmMessage(payload, event);
      }
    }
  } catch (err) {
    console.error("[slack-event] Unhandled error:", err instanceof Error ? err.message : String(err));
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
