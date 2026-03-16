import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import inquirer from "inquirer";
import { loadCredentials, saveCredentials } from "../lib/config";
import { printSuccess, printError } from "../lib/display";

interface LoginOptions {
  email?: string;
  password?: string;
  apiUrl?: string;
  clientId?: string;
  region?: string;
}

export async function login(options: LoginOptions): Promise<void> {
  const existing = loadCredentials();

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
