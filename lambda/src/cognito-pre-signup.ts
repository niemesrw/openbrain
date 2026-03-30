import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

/**
 * Cognito Pre-Signup trigger.
 *
 * When a user signs in with a federated provider (Apple, Google) and a Cognito
 * user with the same email already exists, we link the new provider identity to
 * the existing user. This ensures all providers for the same email resolve to
 * the same sub/userId so data is shared across sign-in methods.
 */
export const handler = async (event: any): Promise<any> => {
  // Only act on federated (external provider) sign-ups
  if (!event.triggerSource?.startsWith("PreSignUp_ExternalProvider")) {
    return event;
  }

  const email: string | undefined = event.request?.userAttributes?.email;
  if (!email) return event;

  const userPoolId: string = event.userPoolId;

  // Find existing Cognito user with this email
  const listResult = await cognito.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${email}"`,
      Limit: 1,
    })
  );

  if (!listResult.Users || listResult.Users.length === 0) {
    // Brand-new user — let Cognito proceed normally
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  const existingUsername = listResult.Users[0].Username!;

  // userName format from Cognito: "Google_106xxx" or "SignInWithApple_000xxx.xxx"
  const underscoreIdx = event.userName.indexOf("_");
  const providerName = event.userName.slice(0, underscoreIdx);
  const providerUserId = event.userName.slice(underscoreIdx + 1);

  await cognito.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: existingUsername,
      },
      SourceUser: {
        ProviderName: providerName,
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: providerUserId,
      },
    })
  );

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
