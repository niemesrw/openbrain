import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createHmac, timingSafeEqual } from "crypto";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { handleSlackEvent } from "./handlers/slack-event";

const sm = new SecretsManagerClient({});

// Cached at Lambda warm-start — secret is stable between deploys
let cachedSigningSecret: string | undefined;

async function getSigningSecret(): Promise<string> {
  if (cachedSigningSecret !== undefined) return cachedSigningSecret;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({
      SecretId: process.env.SLACK_SIGNING_SECRET_NAME!,
    })
  );
  cachedSigningSecret = SecretString ?? "";
  return cachedSigningSecret;
}

const FIVE_MINUTES_S = 5 * 60;

export function verifySlackSignature(
  body: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  nowS: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!secret) return false;
  if (!timestamp || !signature) return false;
  if (!signature.startsWith("v0=")) return false;

  const ts = Number(timestamp);
  if (isNaN(ts) || Math.abs(nowS - ts) > FIVE_MINUTES_S) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", secret).update(baseString).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const headers = event.headers ?? {};
  const timestamp =
    headers["x-slack-request-timestamp"] ?? headers["X-Slack-Request-Timestamp"];
  const signature =
    headers["x-slack-signature"] ?? headers["X-Slack-Signature"];

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");

  const secret = await getSigningSecret();

  if (!verifySlackSignature(rawBody, timestamp, signature, secret)) {
    console.warn("[slack-webhook] Signature verification failed");
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid signature" }) };
  }

  let payload: Record<string, unknown>;
  const contentType = headers["content-type"] ?? headers["Content-Type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    // Slash commands arrive as URL-encoded form data
    payload = Object.fromEntries(new URLSearchParams(rawBody).entries()) as Record<string, unknown>;
    payload.type = "slash_command";
  } else {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }
  }

  // URL verification challenge (Slack sends this when configuring the Events API endpoint)
  if (payload.type === "url_verification") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: payload.challenge }),
    };
  }

  return handleSlackEvent(payload);
}
