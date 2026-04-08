import { createHmac } from "crypto";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});
let cachedSecret: string | null = null;

async function getHmacSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const secretArn = process.env.HMAC_SECRET_ARN;
  if (!secretArn) throw new Error("Missing required configuration: HMAC_SECRET_ARN");
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secret = res.SecretString ?? (res.SecretBinary ? Buffer.from(res.SecretBinary).toString("utf-8") : undefined);
  if (!secret) throw new Error(`Secret ${secretArn} did not contain a usable value`);
  cachedSecret = secret;
  return cachedSecret;
}

export async function hashApiKey(rawKey: string): Promise<string> {
  const secret = await getHmacSecret();
  return createHmac("sha256", secret).update(rawKey).digest("hex");
}
