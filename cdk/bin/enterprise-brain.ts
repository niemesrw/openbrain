#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
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

// Sign in with Apple — optional, only wired when all four values are present
const appleClientId = app.node.tryGetContext("appleClientId") ?? process.env.APPLE_CLIENT_ID;
const appleKeyId = app.node.tryGetContext("appleKeyId") ?? process.env.APPLE_KEY_ID;
const applePrivateKeyArn = app.node.tryGetContext("applePrivateKeyArn") ?? process.env.APPLE_PRIVATE_KEY_ARN;
const appleTeamId = app.node.tryGetContext("appleTeamId") ?? process.env.APPLE_TEAM_ID;
const appleBundleIds = app.node.tryGetContext("appleBundleIds") ?? process.env.APPLE_BUNDLE_IDS;

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
const webOrigin = app.node.tryGetContext("webOrigin") ?? process.env.WEB_ORIGIN
  ?? (customDomain ? `https://${customDomain}` : undefined);

const vectors = new VectorStorageStack(app, "EnterpriseBrainVectors", { env });
const auth = new AuthStack(app, "EnterpriseBrainAuth", {
  env,
  googleClientId,
  googleClientSecretArn,
  callbackUrls,
  logoutUrls,
  appleClientId,
  appleKeyId,
  applePrivateKeyArn,
  appleTeamId,
});
const data = new DataStack(app, "EnterpriseBrainData", { env });
const api = new ApiStack(app, "EnterpriseBrainApi", {
  env,
  vectorBucketName: vectors.vectorBucketName,
  userPool: auth.userPool,
  webClient: auth.webClient,
  cliClient: auth.cliClient,
  mobileClient: auth.mobileClient,
  userPoolDomain: auth.userPoolDomain,
  customDomain,
  webOrigin,
  appleBundleIds,
});

api.addDependency(vectors);
api.addDependency(auth);
// Data must deploy after Api so that Api's old Fn::ImportValue references
// to Data exports are cleared before Data tries to remove those exports.
// Api no longer has cross-stack imports from Data, so this is safe and
// does not create a cycle.
data.addDependency(api);

// Web SPA — build web/ first, then deploy
// Only instantiate when web/dist/ exists (after `cd web && npm run build`)
const web = new WebStack(app, "EnterpriseBrainWeb", {
  env,
  customDomain,
  apiEndpointHostname: api.apiEndpointHostname,
  chatFunctionUrlHostname: api.chatFunctionUrlHostname,
  apiUrl: api.apiUrl,
});
web.addDependency(api);

// Monthly cost budget — sends email when actual spend hits 80% or 100% of $100
const budgetEmail = app.node.tryGetContext("budgetEmail") ?? process.env.BUDGET_EMAIL;
if (budgetEmail) {
  const budgetStack = new cdk.Stack(app, "EnterpriseBrainBudget", { env });
  new budgets.CfnBudget(budgetStack, "MonthlyBudget", {
    budget: {
      budgetName: "openbrain-monthly",
      budgetType: "COST",
      timeUnit: "MONTHLY",
      budgetLimit: { amount: 100, unit: "USD" },
    },
    notificationsWithSubscribers: [
      {
        notification: {
          notificationType: "ACTUAL",
          comparisonOperator: "GREATER_THAN",
          threshold: 80,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "EMAIL", address: budgetEmail }],
      },
      {
        notification: {
          notificationType: "ACTUAL",
          comparisonOperator: "GREATER_THAN",
          threshold: 100,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "EMAIL", address: budgetEmail }],
      },
    ],
  });
}
