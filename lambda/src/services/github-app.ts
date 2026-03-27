import { createSign } from "crypto";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

// Cached for the lifetime of the Lambda container
let cachedPrivateKey: string | undefined;

// Per-installation token cache — avoids minting a new token for every SQS record
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getPrivateKey(): Promise<string> {
  if (cachedPrivateKey !== undefined) return cachedPrivateKey;
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({
      SecretId: process.env.GITHUB_APP_PRIVATE_KEY_SECRET_NAME!,
    })
  );
  cachedPrivateKey = SecretString ?? "";
  return cachedPrivateKey;
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function mintAppJwt(privateKeyPem: string, appId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 480, iss: appId })
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = base64url(sign.sign(privateKeyPem));
  return `${signingInput}.${signature}`;
}

export interface InstallationDetails {
  accountLogin: string;
  accountType: "User" | "Organization";
}

export async function getInstallationDetails(
  installationId: string
): Promise<InstallationDetails> {
  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = await getPrivateKey();
  const jwt = mintAppJwt(privateKey, appId);

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    throw new Error(
      `GitHub installation lookup failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as {
    account: { login: string; type: string };
  };
  return {
    accountLogin: data.account.login,
    accountType:
      data.account.type === "Organization" ? "Organization" : "User",
  };
}

export async function getInstallationToken(
  installationId: string
): Promise<string> {
  const cached = tokenCache.get(installationId);
  // Reuse if more than 5 minutes remain
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token;
  }

  const appId = process.env.GITHUB_APP_ID!;
  const privateKey = await getPrivateKey();
  const jwt = mintAppJwt(privateKey, appId);

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) {
    throw new Error(
      `GitHub token exchange failed: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}
