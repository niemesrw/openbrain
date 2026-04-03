import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import inquirer from "inquirer";
import { saveCredentials } from "../lib/config";
import { callTool } from "../lib/api";
import { printSuccess, printError, printInfo } from "../lib/display";

const DEFAULT_REGION = "us-east-1";

interface SignupOptions {
  apiUrl?: string;
  clientId?: string;
  cognitoDomain?: string;
  region?: string;
}

export async function signup(options: SignupOptions): Promise<void> {
  const answers = await inquirer.prompt([
    { name: "email", message: "Email:", type: "input" },
    { name: "password", message: "Password:", type: "password" },
    { name: "displayName", message: "Display name:", type: "input" },
    ...(!options.apiUrl
      ? [{ name: "apiUrl", message: "API URL:", type: "input" }]
      : []),
    ...(!options.clientId
      ? [{ name: "clientId", message: "CLI Client ID:", type: "input" }]
      : []),
    ...(!options.cognitoDomain
      ? [{ name: "cognitoDomain", message: "Cognito domain URL (for Google login, optional):", type: "input" }]
      : []),
  ]);

  const apiUrl = options.apiUrl || answers.apiUrl;
  const clientId = options.clientId || answers.clientId;
  const cognitoDomain = options.cognitoDomain || answers.cognitoDomain || undefined;
  const region = options.region || DEFAULT_REGION;

  const client = new CognitoIdentityProviderClient({ region });

  // Sign up
  try {
    await client.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: answers.email,
        Password: answers.password,
        UserAttributes: [
          { Name: "email", Value: answers.email },
          { Name: "preferred_username", Value: answers.displayName },
        ],
      })
    );
    printInfo("Check your email for a verification code.");
  } catch (e: any) {
    printError(`Signup failed: ${e.message}`);
    return;
  }

  // Verify
  const { code } = await inquirer.prompt([
    { name: "code", message: "Verification code:", type: "input" },
  ]);

  try {
    await client.send(
      new ConfirmSignUpCommand({
        ClientId: clientId,
        Username: answers.email,
        ConfirmationCode: code,
      })
    );
    printSuccess("Email verified!");
  } catch (e: any) {
    printError(`Verification failed: ${e.message}`);
    return;
  }

  // Auto-login
  try {
    const authResult = await client.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: {
          USERNAME: answers.email,
          PASSWORD: answers.password,
        },
      })
    );

    const auth = authResult.AuthenticationResult!;
    saveCredentials({
      apiUrl,
      region,
      clientId,
      cognitoDomain,
      accessToken: auth.AccessToken!,
      idToken: auth.IdToken!,
      refreshToken: auth.RefreshToken!,
      expiresAt: Date.now() + (auth.ExpiresIn ?? 3600) * 1000,
    });

    printSuccess(`Logged in as ${answers.displayName}`);
  } catch (e: any) {
    printError(`Auto-login failed: ${e.message}`);
    return;
  }

  // Create default agent key
  try {
    printInfo("Creating default agent key...");
    const result = await callTool("create_agent", { name: "personal" });
    console.log(result);
  } catch (e: any) {
    printError(`Could not create default agent: ${e.message}`);
  }
}
