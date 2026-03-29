import { createHmac, timingSafeEqual } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { handleCaptureThought } from "./capture-thought";
import type { UserContext } from "../types";

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const GMAIL_SYNC_LIMIT = 20; // max emails per sync

const GOOGLE_CONNECTIONS_TABLE = process.env.GOOGLE_CONNECTIONS_TABLE!;
const GOOGLE_CLIENT_ID_SECRET_NAME = process.env.GOOGLE_CLIENT_ID_SECRET_NAME!;
const GOOGLE_CLIENT_SECRET_SECRET_NAME = process.env.GOOGLE_CLIENT_SECRET_SECRET_NAME!;
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ?? "https://brain.blanxlait.ai/google/callback";

// gmail.metadata scope — no CASA audit required
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.metadata",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sm = new SecretsManagerClient({});

let cachedClientId: string | undefined;
let cachedClientSecret: string | undefined;

async function getClientId(): Promise<string> {
  if (cachedClientId !== undefined) return cachedClientId;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: GOOGLE_CLIENT_ID_SECRET_NAME })
  );
  if (!SecretString) throw new Error("Google client ID secret is empty or missing");
  cachedClientId = SecretString;
  return cachedClientId;
}

async function getClientSecret(): Promise<string> {
  if (cachedClientSecret !== undefined) return cachedClientSecret;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: GOOGLE_CLIENT_SECRET_SECRET_NAME })
  );
  if (!SecretString) throw new Error("Google client secret is empty or missing");
  cachedClientSecret = SecretString;
  return cachedClientSecret;
}

export interface GoogleConnection {
  userId: string;
  email: string;
  connectedAt: string;
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

export async function handleGoogleConnect(user: UserContext): Promise<{ url: string }> {
  const [clientId, clientSecret] = await Promise.all([getClientId(), getClientSecret()]);
  const state = generateState(user.userId, clientSecret);
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(GOOGLE_SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${encodeURIComponent(state)}`;
  return { url };
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  error?: { message: string };
}

export async function handleGoogleCallback(
  code: string,
  state: string,
  user: UserContext
): Promise<{ ok: boolean; email: string }> {
  const [clientId, clientSecret] = await Promise.all([
    getClientId(),
    getClientSecret(),
  ]);

  verifyState(state, user.userId, clientSecret);

  // Exchange code for tokens
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenResp.ok) {
    throw new Error(`Google token exchange HTTP error: ${tokenResp.status}`);
  }

  const tokenData = (await tokenResp.json()) as GoogleTokenResponse;
  if (tokenData.error) {
    throw new Error(`Google token exchange error: ${tokenData.error_description ?? tokenData.error}`);
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  if (!accessToken) throw new Error("Google token response missing access_token");
  if (!refreshToken) throw new Error("Google token response missing refresh_token — ensure access_type=offline and prompt=consent were set");

  const expiresIn = tokenData.expires_in ?? 3600;
  const accessTokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Fetch the user's email address from Google
  const userInfoResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userInfoResp.ok) {
    throw new Error(`Google userinfo HTTP error: ${userInfoResp.status}`);
  }

  const userInfo = (await userInfoResp.json()) as GoogleUserInfoResponse;
  const email = userInfo.email;
  if (!email) throw new Error("Google userinfo response missing email");

  await ddb.send(
    new PutCommand({
      TableName: GOOGLE_CONNECTIONS_TABLE,
      Item: {
        userId: user.userId,
        email,
        refreshToken,
        accessToken,
        accessTokenExpiry,
        connectedAt: new Date().toISOString(),
      },
    })
  );

  return { ok: true, email };
}

export async function handleGoogleConnections(
  user: UserContext
): Promise<{ connections: GoogleConnection[] }> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: GOOGLE_CONNECTIONS_TABLE,
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": user.userId },
    })
  );

  return {
    connections: (result.Items ?? []).map((item) => ({
      userId: item.userId as string,
      email: item.email as string,
      connectedAt: item.connectedAt as string,
    })),
  };
}

export async function handleGoogleDisconnect(
  email: string,
  user: UserContext
): Promise<{ ok: boolean }> {
  await ddb.send(
    new DeleteCommand({
      TableName: GOOGLE_CONNECTIONS_TABLE,
      Key: { userId: user.userId, email },
    })
  );
  return { ok: true };
}

interface GmailProfileResponse {
  historyId?: string;
  error?: { message: string };
}

interface GmailHistoryResponse {
  history?: Array<{
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
  }>;
  historyId?: string;
  error?: { message: string };
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  error?: { message: string };
}

interface GmailMessageHeadersResponse {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
  error?: { message: string };
}

async function refreshAccessToken(
  userId: string,
  email: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!resp.ok) {
    throw new Error(`Google token refresh HTTP error: ${resp.status}`);
  }

  const data = (await resp.json()) as GoogleTokenResponse;
  if (data.error) {
    throw new Error(`Google token refresh error: ${data.error_description ?? data.error}`);
  }

  const newAccessToken = data.access_token;
  if (!newAccessToken) throw new Error("Token refresh response missing access_token");

  const expiresIn = data.expires_in ?? 3600;
  const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Persist updated access token + expiry
  await ddb.send(
    new UpdateCommand({
      TableName: GOOGLE_CONNECTIONS_TABLE,
      Key: { userId, email },
      UpdateExpression: "SET accessToken = :at, accessTokenExpiry = :exp",
      ExpressionAttributeValues: { ":at": newAccessToken, ":exp": newExpiry },
    })
  );

  return newAccessToken;
}

async function getValidAccessToken(
  userId: string,
  email: string,
  clientId: string,
  clientSecret: string
): Promise<{ accessToken: string; lastHistoryId?: string }> {
  const result = await ddb.send(
    new GetCommand({
      TableName: GOOGLE_CONNECTIONS_TABLE,
      Key: { userId, email },
    })
  );

  const item = result.Item;
  if (!item) throw new Error(`No Google connection found for ${email}`);

  const expiry = new Date(item.accessTokenExpiry as string).getTime();
  // Refresh if expiring within 5 minutes
  const accessToken = Date.now() >= expiry - 5 * 60 * 1000
    ? await refreshAccessToken(userId, email, item.refreshToken as string, clientId, clientSecret)
    : (item.accessToken as string);

  return { accessToken, lastHistoryId: item.lastHistoryId as string | undefined };
}

export interface GoogleSyncResult {
  ok: boolean;
  email: string;
  captured: number;
  skipped: number;
}

export async function handleGoogleSync(
  email: string,
  user: UserContext
): Promise<GoogleSyncResult> {
  const [clientId, clientSecret] = await Promise.all([getClientId(), getClientSecret()]);
  const { accessToken, lastHistoryId } = await getValidAccessToken(user.userId, email, clientId, clientSecret);

  let messageIds: string[];
  let newHistoryId: string | undefined;

  if (lastHistoryId) {
    // Incremental sync — only messages added since last sync
    const histUrl =
      `https://gmail.googleapis.com/gmail/v1/users/me/history` +
      `?startHistoryId=${encodeURIComponent(lastHistoryId)}&historyTypes=messageAdded&maxResults=${GMAIL_SYNC_LIMIT}`;

    const histResp = await fetch(histUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!histResp.ok) {
      throw new Error(`Gmail history HTTP error: ${histResp.status}`);
    }

    const histData = (await histResp.json()) as GmailHistoryResponse;
    if (histData.error) {
      throw new Error(`Gmail history error: ${histData.error.message}`);
    }

    messageIds = (histData.history ?? []).flatMap(
      (h) => (h.messagesAdded ?? []).map((m) => m.message.id)
    );
    newHistoryId = histData.historyId;
  } else {
    // Initial full sync — list recent messages
    const listUrl =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
      `?maxResults=${GMAIL_SYNC_LIMIT}`;

    const listResp = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listResp.ok) {
      throw new Error(`Gmail list messages HTTP error: ${listResp.status}`);
    }

    const listData = (await listResp.json()) as GmailMessageListResponse;
    if (listData.error) {
      throw new Error(`Gmail list messages error: ${listData.error.message}`);
    }

    messageIds = (listData.messages ?? []).map((m) => m.id);

    // Fetch current historyId to use as cursor for future incremental syncs
    const profileResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileResp.ok) {
      const profileData = (await profileResp.json()) as GmailProfileResponse;
      newHistoryId = profileData.historyId;
    }
  }

  let captured = 0;
  let skipped = 0;

  for (const id of messageIds) {
    try {
      // Fetch message metadata (headers only — no body, no base64)
      const msgUrl =
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
        `?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`;

      const msgResp = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!msgResp.ok) {
        console.error(`Gmail fetch message ${id} HTTP error: ${msgResp.status}`);
        skipped++;
        continue;
      }

      const msg = (await msgResp.json()) as GmailMessageHeadersResponse;
      if (msg.error) {
        console.error(`Gmail fetch message ${id} error: ${msg.error.message}`);
        skipped++;
        continue;
      }

      const headers = msg.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

      const from = getHeader("From");
      const to = getHeader("To");
      const subject = getHeader("Subject") || "(no subject)";
      const date = getHeader("Date");
      const labels = (msg.labelIds ?? []).filter(
        (l) => !["UNREAD", "INBOX", "SENT", "SPAM", "TRASH"].includes(l)
      );

      // Build a concise human-readable thought
      const parts: string[] = [`Email: ${subject}`];
      if (from) parts.push(`From: ${from}`);
      if (to) parts.push(`To: ${to}`);
      if (date) parts.push(`Date: ${date}`);
      if (labels.length > 0) parts.push(`Labels: ${labels.join(", ")}`);
      parts.push(`Thread: ${msg.threadId ?? id}`);
      const text = parts.join("\n");

      await handleCaptureThought({ text, scope: "private" }, user);
      captured++;
    } catch (e) {
      console.error(`Failed to process message ${id}:`, e instanceof Error ? e.message : String(e));
      skipped++;
    }
  }

  // Persist cursor so the next sync fetches only new messages
  if (newHistoryId) {
    await ddb.send(
      new UpdateCommand({
        TableName: GOOGLE_CONNECTIONS_TABLE,
        Key: { userId: user.userId, email },
        UpdateExpression: "SET lastHistoryId = :h",
        ExpressionAttributeValues: { ":h": newHistoryId },
      })
    );
  }

  return { ok: true, email, captured, skipped };
}
