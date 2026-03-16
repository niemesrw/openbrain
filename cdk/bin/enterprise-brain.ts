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

const vectors = new VectorStorageStack(app, "EnterpriseBrainVectors", { env });
const auth = new AuthStack(app, "EnterpriseBrainAuth", { env });
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
