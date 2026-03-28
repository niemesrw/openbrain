import { createHmac, timingSafeEqual } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import type { UserContext } from "../types";

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const SLACK_INSTALLATIONS_TABLE = process.env.SLACK_INSTALLATIONS_TABLE!;
const SLACK_CLIENT_ID_SECRET_NAME = process.env.SLACK_CLIENT_ID_SECRET_NAME!;
const SLACK_CLIENT_SECRET_SECRET_NAME = process.env.SLACK_CLIENT_SECRET_SECRET_NAME!;
// Allow per-environment override; fall back to production domain
const REDIRECT_URI =
  process.env.SLACK_REDIRECT_URI ?? "https://brain.blanxlait.ai/slack/callback";
const SLACK_SCOPES = "chat:write,im:history,im:write,commands";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm = new SecretsManagerClient({});

let cachedClientId: string | undefined;
let cachedClientSecret: string | undefined;

async function getClientId(): Promise<string> {
  if (cachedClientId !== undefined) return cachedClientId;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: SLACK_CLIENT_ID_SECRET_NAME })
  );
  if (!SecretString) throw new Error("Slack client ID secret is empty or missing");
  cachedClientId = SecretString;
  return cachedClientId;
}

async function getClientSecret(): Promise<string> {
  if (cachedClientSecret !== undefined) return cachedClientSecret;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: SLACK_CLIENT_SECRET_SECRET_NAME })
  );
  if (!SecretString) throw new Error("Slack client secret is empty or missing");
  cachedClientSecret = SecretString;
  return cachedClientSecret;
}

export interface SlackInstallation {
  teamId: string;
  userId: string;
  teamName: string;
  botUserId: string;
  slackUserId: string;
  installedAt: string;
}

function generateState(userId: string, clientSecret: string): string {
  const timestamp = Date.now();
  const payload = `${userId}:${timestamp}`;
  const sig = createHmac("sha256", clientSecret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyState(state: string, userId: string, clientSecret: string): void {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    throw new Error("Invalid state parameter");
  }

  const colonIdx = decoded.lastIndexOf(":");
  if (colonIdx === -1) throw new Error("Invalid state format");

  const payload = decoded.slice(0, colonIdx);
  const sig = decoded.slice(colonIdx + 1);

  const parts = payload.split(":");
  if (parts.length < 2) throw new Error("Invalid state format");

  const stateUserId = parts.slice(0, -1).join(":");
  const timestamp = parseInt(parts[parts.length - 1], 10);

  if (stateUserId !== userId) throw new Error("State user mismatch");
  if (isNaN(timestamp) || Date.now() - timestamp > STATE_TTL_MS) {
    throw new Error("State expired or invalid");
  }

  const expected = createHmac("sha256", clientSecret).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("State signature invalid");
  }
}

export async function handleSlackInstall(user: UserContext): Promise<{ url: string }> {
  const [clientId, clientSecret] = await Promise.all([getClientId(), getClientSecret()]);
  const state = generateState(user.userId, clientSecret);
  const url =
    `https://slack.com/oauth/v2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(SLACK_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${encodeURIComponent(state)}`;
  return { url };
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  bot_user_id?: string;
  access_token?: string;
  authed_user?: { id: string };
}

export async function handleSlackCallback(
  code: string,
  state: string,
  user: UserContext
): Promise<{ ok: boolean; teamName: string; dmSent: boolean }> {
  const [clientId, clientSecret] = await Promise.all([
    getClientId(),
    getClientSecret(),
  ]);

  verifyState(state, user.userId, clientSecret);

  const params = new URLSearchParams({ code, redirect_uri: REDIRECT_URI });
  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: params.toString(),
  });

  if (!resp.ok) {
    throw new Error(`Slack API HTTP error: ${resp.status}`);
  }

  const data = (await resp.json()) as SlackOAuthResponse;
  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error ?? "unknown"}`);
  }

  const teamId = data.team?.id;
  const botUserId = data.bot_user_id;
  const accessToken = data.access_token;
  const slackUserId = data.authed_user?.id;

  if (!teamId) throw new Error("Slack OAuth response missing required field: team.id");
  if (!botUserId) throw new Error("Slack OAuth response missing required field: bot_user_id");
  if (!accessToken) throw new Error("Slack OAuth response missing required field: access_token");
  if (!slackUserId) throw new Error("Slack OAuth response missing required field: authed_user.id");

  const teamName = data.team?.name ?? "";

  await ddb.send(
    new PutCommand({
      TableName: SLACK_INSTALLATIONS_TABLE,
      Item: {
        teamId,
        userId: user.userId,
        teamName,
        botUserId,
        slackUserId,
        accessToken,
        installedAt: new Date().toISOString(),
      },
      ConditionExpression:
        "attribute_not_exists(teamId) OR userId = :uid",
      ExpressionAttributeValues: { ":uid": user.userId },
    })
  );

  const dmSent = await sendConfirmationDm(accessToken, slackUserId).then(
    () => true,
    (e: unknown) => {
      console.error(
        "Failed to send Slack confirmation DM:",
        e instanceof Error ? e.message : String(e)
      );
      return false;
    }
  );

  return { ok: true, teamName, dmSent };
}

async function sendConfirmationDm(accessToken: string, slackUserId: string): Promise<void> {
  // First open a DM channel with the user — Slack requires a channel ID, not a user ID
  const openResp = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ users: slackUserId }),
  });

  if (!openResp.ok) {
    throw new Error(`Slack conversations.open HTTP error: ${openResp.status}`);
  }

  const openData = (await openResp.json()) as { ok: boolean; error?: string; channel?: { id: string } };
  if (!openData.ok) {
    throw new Error(`Slack conversations.open error: ${openData.error ?? "unknown"}`);
  }

  const channelId = openData.channel?.id;
  if (!channelId) throw new Error("Slack conversations.open returned no channel ID");

  const msgResp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      channel: channelId,
      text: "Your Open Brain is connected 🧠 Try /brain search <query>",
    }),
  });

  if (!msgResp.ok) {
    throw new Error(`Slack chat.postMessage HTTP error: ${msgResp.status}`);
  }

  const msgData = (await msgResp.json()) as { ok: boolean; error?: string };
  if (!msgData.ok) {
    throw new Error(`Slack DM error: ${msgData.error ?? "unknown"}`);
  }
}

export async function handleSlackInstallations(
  user: UserContext
): Promise<{ installations: SlackInstallation[] }> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: SLACK_INSTALLATIONS_TABLE,
      IndexName: "user-id-index",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": user.userId },
    })
  );

  return {
    installations: (result.Items ?? []).map((item) => ({
      teamId: item.teamId as string,
      userId: item.userId as string,
      teamName: item.teamName as string,
      botUserId: item.botUserId as string,
      slackUserId: item.slackUserId as string,
      installedAt: item.installedAt as string,
    })),
  };
}

export async function handleSlackDisconnect(
  teamId: string,
  user: UserContext
): Promise<{ ok: boolean }> {
  await ddb.send(
    new DeleteCommand({
      TableName: SLACK_INSTALLATIONS_TABLE,
      Key: { teamId, userId: user.userId },
    })
  );
  return { ok: true };
}
