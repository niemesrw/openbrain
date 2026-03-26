import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import inquirer from "inquirer";
import { loadCredentials, saveCredentials } from "../lib/config";
import { oauthLogin } from "../lib/oauth";
import { printSuccess, printError } from "../lib/display";

interface LoginOptions {
  email?: string;
  password?: string;
  google?: boolean;
  apiUrl?: string;
  clientId?: string;
  cognitoDomain?: string;
  region?: string;
}

export async function login(options: LoginOptions): Promise<void> {
  const existing = loadCredentials();

  // If --google flag, use OAuth browser flow
  if (options.google) {
    const apiUrl = options.apiUrl || existing?.apiUrl;
    const clientId = options.clientId || existing?.clientId;
    const region = options.region || existing?.region || "us-east-1";
    const cognitoDomain = options.cognitoDomain || existing?.cognitoDomain;

    if (!apiUrl || !clientId || !cognitoDomain) {
      printError(
        "Google login requires API URL, Client ID, and Cognito domain.\n" +
        "  Run `brain signup` first, or pass --api-url, --client-id, and --cognito-domain."
      );
      return;
    }

    try {
      await oauthLogin({ cognitoDomain, clientId, region, apiUrl });
    } catch (e: any) {
      printError(`Google login failed: ${e.message}`);
    }
    return;
  }

  // If no flags given, ask how they want to log in
  if (!options.email && !options.password) {
    const hasCognitoDomain = !!(options.cognitoDomain || existing?.cognitoDomain);
    if (hasCognitoDomain) {
      const { method } = await inquirer.prompt([
        {
          name: "method",
          message: "How would you like to log in?",
          type: "list",
          choices: [
            { name: "Email / password", value: "password" },
            { name: "Google (opens browser)", value: "google" },
          ],
        },
      ]);
      if (method === "google") {
        return login({ ...options, google: true });
      }
    }
  }

  // Password flow
  let email = options.email;
  let password = options.password;

  if (!email || !password) {
    const answers = await inquirer.prompt([
      ...(!email ? [{ name: "email", message: "Email:", type: "input" }] : []),
      ...(!password
        ? [{ name: "password", message: "Password:", type: "password" }]
        : []),
    ]);
    email = email || answers.email;
    password = password || answers.password;
  }

  const apiUrl = options.apiUrl || existing?.apiUrl;
  const clientId = options.clientId || existing?.clientId;
  const region = options.region || existing?.region || "us-east-1";

  if (!apiUrl || !clientId) {
    printError(
      "No saved config found. Run `brain signup` first, or pass --api-url and --client-id."
    );
    return;
  }

  const client = new CognitoIdentityProviderClient({ region });

  try {
    const result = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: {
          USERNAME: email!,
          PASSWORD: password!,
        },
      })
    );

    const auth = result.AuthenticationResult!;
    saveCredentials({
      apiUrl,
      region,
      clientId,
      cognitoDomain: options.cognitoDomain || existing?.cognitoDomain,
      accessToken: auth.AccessToken!,
      idToken: auth.IdToken!,
      refreshToken: auth.RefreshToken!,
      expiresAt: Date.now() + (auth.ExpiresIn ?? 3600) * 1000,
    });

    printSuccess("Logged in successfully.");
  } catch (e: any) {
    printError(`Login failed: ${e.message}`);
  }
}
