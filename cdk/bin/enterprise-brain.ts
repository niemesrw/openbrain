#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { VectorStorageStack } from "../lib/stacks/vector-storage-stack";
import { AuthStack } from "../lib/stacks/auth-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { ApiStack } from "../lib/stacks/api-stack";
import { WebStack } from "../lib/stacks/web-stack";
import { TelegramStack } from "../lib/stacks/telegram-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const googleClientId = app.node.tryGetContext("googleClientId") ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecretArn = app.node.tryGetContext("googleClientSecretArn") ?? process.env.GOOGLE_CLIENT_SECRET_ARN;

if (!googleClientId || !googleClientSecretArn) {
  throw new Error(
    "Google OAuth credentials required. Set via context (-c googleClientId=... -c googleClientSecretArn=...) " +
    "or environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET_ARN). " +
    "Store the Google client secret in AWS Secrets Manager and pass the secret ARN."
  );
}

function parseStringOrArray(val: unknown, fallback: string[]): string[] {
  if (!val) return fallback;
  if (Array.isArray(val)) return val;
  if (typeof val === "string") return JSON.parse(val);
  return fallback;
}

const callbackUrls = parseStringOrArray(app.node.tryGetContext("callbackUrls"), [
  "http://localhost:5173/callback",
]);
const logoutUrls = parseStringOrArray(app.node.tryGetContext("logoutUrls"), [
  "http://localhost:5173/login",
]);

const customDomain = app.node.tryGetContext("customDomain") ?? process.env.CUSTOM_DOMAIN;

const vectors = new VectorStorageStack(app, "EnterpriseBrainVectors", { env });
const auth = new AuthStack(app, "EnterpriseBrainAuth", {
  env,
  googleClientId,
  googleClientSecretArn,
  callbackUrls,
  logoutUrls,
});
const data = new DataStack(app, "EnterpriseBrainData", { env });
const api = new ApiStack(app, "EnterpriseBrainApi", {
  env,
  vectorBucketName: vectors.vectorBucketName,
  userPool: auth.userPool,
  webClient: auth.webClient,
  cliClient: auth.cliClient,
  agentKeysTable: data.agentKeysTable,
  usersTable: data.usersTable,
  agentTasksTable: data.agentTasksTable,
  dcrClientsTable: data.dcrClientsTable,
  telegramTokensTable: data.telegramTokensTable,
  customDomain,
  alarmEmail: app.node.tryGetContext("alarmEmail") ?? process.env.ALARM_EMAIL,
});

api.addDependency(vectors);
api.addDependency(auth);
api.addDependency(data);

// Telegram bot — optional; only deployed when telegramBotTokenSecretArn is provided
const telegramBotTokenSecretArn =
  app.node.tryGetContext("telegramBotTokenSecretArn") ??
  process.env.TELEGRAM_BOT_TOKEN_SECRET_ARN;

if (telegramBotTokenSecretArn) {
  const telegram = new TelegramStack(app, "EnterpriseBrainTelegram", {
    env,
    httpApi: api.api,
    vectorBucketName: vectors.vectorBucketName,
    telegramUsersTable: data.telegramUsersTable,
    telegramTokensTable: data.telegramTokensTable,
    telegramBotTokenSecretArn,
  });
  telegram.addDependency(api);
  telegram.addDependency(data);
}

// Web SPA — build web/ first, then deploy
// Only instantiate when web/dist/ exists (after `cd web && npm run build`)
const web = new WebStack(app, "EnterpriseBrainWeb", {
  env,
  customDomain,
  apiEndpointHostname: customDomain ? api.apiEndpointHostname : undefined,
});
web.addDependency(api);
