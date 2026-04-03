import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

// Validates email format before use in Cognito filter strings.
// Emails that don't match skip account-linking (sign-up still proceeds)
// so we never interpolate untrusted input into the ListUsers filter.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;

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

  // Skip account-linking for emails that fail format validation — sign-up
  // proceeds normally but we do not interpolate untrusted input into the
  // Cognito ListUsers filter string
  if (!EMAIL_RE.test(email)) return event;

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
