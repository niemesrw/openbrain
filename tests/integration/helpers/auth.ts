import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getConfig } from "./config.js";

const tokenCaches: Record<"a" | "b", { token: string; expiresAt: number } | undefined> = {
  a: undefined,
  b: undefined,
};

async function authenticate(username: string, password: string, clientId: string): Promise<{ token: string; expiresIn: number }> {
  const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });
  const res = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    })
  );
  return {
    token: res.AuthenticationResult!.AccessToken!,
    expiresIn: res.AuthenticationResult!.ExpiresIn! * 1000,
  };
}

/** Returns a Cognito access token for the primary test user (user A). */
export async function getToken(): Promise<string> {
  const now = Date.now();
  if (tokenCaches.a && tokenCaches.a.expiresAt > now + 60_000) {
    return tokenCaches.a.token;
  }
  const config = await getConfig();
  const { token, expiresIn } = await authenticate(config.username, config.password, config.clientId);
  tokenCaches.a = { token, expiresAt: now + expiresIn };
  return token;
}

/**
 * Returns a Cognito access token for the secondary test user (user B).
 * Throws if user B credentials are not configured in the test secret.
 */
export async function getTokenB(): Promise<string> {
  const now = Date.now();
  if (tokenCaches.b && tokenCaches.b.expiresAt > now + 60_000) {
    return tokenCaches.b.token;
  }
  const config = await getConfig();
  if (!config.usernameB || !config.passwordB) {
    throw new Error(
      "User B credentials not configured. Add username_b and password_b to /openbrain/ci/credentials " +
      "or set OPENBRAIN_USERNAME_B and OPENBRAIN_PASSWORD_B environment variables."
    );
  }
  const { token, expiresIn } = await authenticate(config.usernameB, config.passwordB, config.clientId);
  tokenCaches.b = { token, expiresAt: now + expiresIn };
  return token;
}

/** Returns true if user B credentials are available, false otherwise. */
export async function hasUserB(): Promise<boolean> {
  const config = await getConfig();
  return !!(config.usernameB && config.passwordB);
}
