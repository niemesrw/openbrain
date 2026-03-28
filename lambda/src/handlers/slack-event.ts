import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { handleSearchThoughts } from "./search-thoughts";
import { handleCaptureThought } from "./capture-thought";
import type { UserContext } from "../types";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
      TableName: process.env.SLACK_INSTALLATIONS_TABLE,
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

async function postMessage(token: string, channel: string, text: string): Promise<void> {
  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  if (!resp.ok) {
    throw new Error(`Slack chat.postMessage HTTP error: ${resp.status}`);
  }
  const data = (await resp.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack chat.postMessage error: ${data.error ?? "unknown"}`);
  }
}

async function postToResponseUrl(url: string, text: string): Promise<void> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text }),
    });
    if (!resp.ok) {
      console.error(`[slack-event] postToResponseUrl HTTP error: ${resp.status}`);
    }
  } catch (err) {
    console.error(
      "[slack-event] postToResponseUrl network error:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

function slashResponse(text: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text }),
  };
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
    // Fire-and-forget: return ack immediately, post result to response_url to avoid Slack's 3s timeout
    void (async () => {
      try {
        const result = await handleSearchThoughts(
          { query: args, limit: 5, threshold: 0.5, scope: "private" },
          user
        );
        if (responseUrl) await postToResponseUrl(responseUrl, result);
      } catch (err) {
        console.error("[slack-event] Search error:", err instanceof Error ? err.message : String(err));
        if (responseUrl) await postToResponseUrl(responseUrl, "Sorry, something went wrong while searching your brain.");
      }
    })();
    return slashResponse("Searching your brain…");
  }

  if (subcommand === "capture") {
    if (!args) return slashResponse("Usage: `/brain capture <thought>`");
    void (async () => {
      try {
        const result = await handleCaptureThought({ text: args, scope: "private" }, user);
        if (responseUrl) await postToResponseUrl(responseUrl, result);
      } catch (err) {
        console.error("[slack-event] Capture error:", err instanceof Error ? err.message : String(err));
        if (responseUrl) await postToResponseUrl(responseUrl, "Sorry, something went wrong while capturing your thought.");
      }
    })();
    return slashResponse("Capturing your thought…");
  }

  // Treat unrecognized text as a search query
  void (async () => {
    try {
      const result = await handleSearchThoughts(
        { query: text, limit: 5, threshold: 0.5, scope: "private" },
        user
      );
      if (responseUrl) await postToResponseUrl(responseUrl, result);
    } catch (err) {
      console.error("[slack-event] Search error:", err instanceof Error ? err.message : String(err));
      if (responseUrl) await postToResponseUrl(responseUrl, "Sorry, something went wrong while searching your brain.");
    }
  })();
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

  const user = buildUserContext(installation.userId);
  const token = installation.accessToken;

  // Route on prefix: "capture: <text>" or "save: <text>" → capture, else search
  const captureMatch = text.match(/^(?:capture|save):\s*(.+)/is);

  let responseText: string;
  try {
    if (captureMatch) {
      responseText = await handleCaptureThought(
        { text: captureMatch[1].trim(), scope: "private" },
        user
      );
    } else {
      responseText = await handleSearchThoughts(
        { query: text, limit: 5, threshold: 0.5, scope: "private" },
        user
      );
    }
  } catch (err) {
    console.error("[slack-event] Brain DM error:", err instanceof Error ? err.message : String(err));
    responseText = "Sorry, I encountered an error. Try again or use `/brain` commands.";
  }

  await postMessage(token, channel, responseText);
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
        // Fire-and-forget: Slack requires 200 within 3 seconds
        void handleDmMessage(payload, event).catch((err) => {
          console.error(
            "[slack-event] DM handler unhandled error:",
            err instanceof Error ? err.message : String(err)
          );
        });
      }
    }
  } catch (err) {
    console.error("[slack-event] Unhandled error:", err instanceof Error ? err.message : String(err));
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}

