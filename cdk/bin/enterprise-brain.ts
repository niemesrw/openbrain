#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { VectorStorageStack } from "../lib/stacks/vector-storage-stack";
import { AuthStack } from "../lib/stacks/auth-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { ApiStack } from "../lib/stacks/api-stack";
import { WebStack } from "../lib/stacks/web-stack";

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
});

api.addDependency(vectors);
api.addDependency(auth);
api.addDependency(data);

// Web SPA — build web/ first, then deploy
// Only instantiate when web/dist/ exists (after `cd web && npm run build`)
const web = new WebStack(app, "EnterpriseBrainWeb", { env });
web.addDependency(api);
