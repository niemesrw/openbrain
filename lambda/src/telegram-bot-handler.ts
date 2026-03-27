import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { handleTelegramWebhook } from "./handlers/telegram-bot";

const secretsClient = new SecretsManagerClient({});

// Cache webhook secret across warm invocations
let cachedWebhookSecret: string | null = null;

async function getWebhookSecret(): Promise<string> {
  if (cachedWebhookSecret) return cachedWebhookSecret;
  const secretArn = process.env.TELEGRAM_WEBHOOK_SECRET_ARN!;
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  cachedWebhookSecret = res.SecretString!.trim();
  return cachedWebhookSecret;
}

export async function handler(event: APIGatewayProxyEventV2) {
  // Verify Telegram webhook secret token (case-insensitive header lookup)
  const expectedSecret = await getWebhookSecret();
  const headerKey = Object.keys(event.headers || {}).find(
    (k) => k.toLowerCase() === "x-telegram-bot-api-secret-token"
  );
  const provided = headerKey && event.headers ? event.headers[headerKey] : undefined;
  if (provided !== expectedSecret) {
    return { statusCode: 403, body: "Forbidden" };
  }

  return handleTelegramWebhook(event);
}
