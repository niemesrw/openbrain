import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createHmac, timingSafeEqual } from "crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const sqs = new SQSClient({});
const sm = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Cached at Lambda warm-start — secret is stable between deploys
let cachedWebhookSecret: string | undefined;

async function getWebhookSecret(): Promise<string> {
  if (cachedWebhookSecret !== undefined) return cachedWebhookSecret;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({
      SecretId: process.env.GITHUB_WEBHOOK_SECRET_NAME!,
    })
  );
  cachedWebhookSecret = SecretString ?? "";
  return cachedWebhookSecret;
}

const RELEVANT_EVENTS = new Set([
  "installation",
  "pull_request",
  "pull_request_review",
  "push",
  "release",
]);

export function verifySignature(
  body: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!secret) return false;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuf = Buffer.from(`sha256=${expected}`, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const headers = event.headers ?? {};
  // API Gateway v2 lowercases headers, but normalise both variants to be safe
  const signature =
    headers["x-hub-signature-256"] ?? headers["X-Hub-Signature-256"];
  const eventType =
    headers["x-github-event"] ?? headers["X-GitHub-Event"];

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");

  const secret = await getWebhookSecret();

  if (!verifySignature(rawBody, signature, secret)) {
    console.warn("[github-webhook] Signature verification failed");
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid signature" }) };
  }

  if (!eventType || !RELEVANT_EVENTS.has(eventType)) {
    return { statusCode: 200, body: JSON.stringify({ status: "ignored", eventType }) };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const installationId = (payload.installation as { id?: number } | undefined)?.id;

  // Handle installation lifecycle events inline (fast DynamoDB op, no SQS needed)
  if (eventType === "installation") {
    if (payload.action === "deleted") {
      if (installationId) {
        const tableName = process.env.GITHUB_INSTALLATIONS_TABLE;
        if (!tableName) {
          console.error("[github-webhook] GITHUB_INSTALLATIONS_TABLE env var is not set");
          return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error" }) };
        }
        await ddb.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { installationId: String(installationId) },
          })
        );
        console.log("[github-webhook] Deleted installation record", { installationId });
      }
    } else {
      console.log("[github-webhook] Ignoring installation action", { action: payload.action });
    }
    return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
  }

  if (!installationId) {
    // Events without an installation ID can't be routed to a user — drop them
    console.warn("[github-webhook] Event missing installation.id, ignoring", { eventType });
    return { statusCode: 200, body: JSON.stringify({ status: "ignored", reason: "no installation" }) };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.GITHUB_EVENTS_QUEUE_URL!,
      MessageBody: JSON.stringify({
        eventType,
        installationId,
        payload: rawBody,
        receivedAt: new Date().toISOString(),
      }),
    })
  );

  console.log("[github-webhook] Queued event", { eventType, installationId });
  return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
}
