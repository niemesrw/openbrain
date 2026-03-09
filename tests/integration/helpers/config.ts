/**
 * Loads test configuration from environment variables (CI) or Secrets Manager (local).
 *
 * CI:    Set OPENBRAIN_API_URL, OPENBRAIN_USERNAME, OPENBRAIN_PASSWORD,
 *        OPENBRAIN_CLIENT_ID as environment variables (sourced from Secrets Manager
 *        by the CI job before running tests).
 *
 * Local: Set AWS_PROFILE=management-admin. Config is fetched automatically
 *        from /openbrain/ci/credentials in Secrets Manager.
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export interface TestConfig {
  apiUrl: string;
  username: string;
  password: string;
  clientId: string;
  userPoolId: string;
}

let cached: TestConfig | undefined;

export async function getConfig(): Promise<TestConfig> {
  if (cached) return cached;

  // CI path: all values injected as env vars
  if (process.env.OPENBRAIN_API_URL) {
    cached = {
      apiUrl: process.env.OPENBRAIN_API_URL,
      username: process.env.OPENBRAIN_USERNAME!,
      password: process.env.OPENBRAIN_PASSWORD!,
      clientId: process.env.OPENBRAIN_CLIENT_ID!,
      userPoolId: process.env.OPENBRAIN_USER_POOL_ID!,
    };
    return cached;
  }

  // Local path: fetch from Secrets Manager
  const sm = new SecretsManagerClient({ region: "us-east-1" });
  const res = await sm.send(
    new GetSecretValueCommand({ SecretId: "/openbrain/ci/credentials" })
  );
  const secret = JSON.parse(res.SecretString!);
  cached = {
    apiUrl: secret.api_url,
    username: secret.username,
    password: secret.password,
    clientId: secret.client_id,
    userPoolId: secret.user_pool_id,
  };
  return cached;
}
