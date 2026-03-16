import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { loadCredentials, saveCredentials, type Credentials } from "./config";

export async function ensureAuth(): Promise<Credentials> {
  const creds = loadCredentials();
  if (!creds) {
    console.error(
      "Not logged in. Run `brain login` or `brain signup` first."
    );
    process.exit(1);
  }

  // Auto-refresh if expired (with 60s buffer)
  if (Date.now() >= creds.expiresAt - 60_000) {
    return refreshTokens(creds);
  }

  return creds;
}

async function refreshTokens(creds: Credentials): Promise<Credentials> {
  const client = new CognitoIdentityProviderClient({
    region: creds.region,
  });

  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: creds.clientId,
        AuthParameters: {
          REFRESH_TOKEN: creds.refreshToken,
        },
      })
    );

    const auth = result.AuthenticationResult!;
    const updated: Credentials = {
      ...creds,
      accessToken: auth.AccessToken!,
      idToken: auth.IdToken!,
      expiresAt: Date.now() + (auth.ExpiresIn ?? 3600) * 1000,
    };

    saveCredentials(updated);
    return updated;
  } catch (e) {
    console.error("Session expired. Please run `brain login` again.");
    process.exit(1);
  }
}
