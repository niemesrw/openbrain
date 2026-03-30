import { handler } from "../cognito-pre-signup";

jest.mock("@aws-sdk/client-cognito-identity-provider", () => {
  const mockSend = jest.fn();
  return {
    __mockSend: mockSend,
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ListUsersCommand: jest.fn((input: unknown) => ({ input })),
    AdminLinkProviderForUserCommand: jest.fn((input: unknown) => ({ input })),
  };
});

const cognitoMock = jest.requireMock("@aws-sdk/client-cognito-identity-provider");
const mockSend: jest.Mock = cognitoMock.__mockSend;
const { ListUsersCommand, AdminLinkProviderForUserCommand } = cognitoMock;

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    triggerSource: "PreSignUp_ExternalProvider",
    userPoolId: "us-east-1_ABC123",
    userName: "Google_106123456789",
    request: { userAttributes: { email: "user@example.com" } },
    response: {},
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

test("links identities when existing user found", async () => {
  mockSend
    .mockResolvedValueOnce({ Users: [{ Username: "existingCognitoUser" }] }) // listUsers
    .mockResolvedValueOnce({}); // adminLinkProviderForUser

  const result = await handler(makeEvent());

  expect(ListUsersCommand).toHaveBeenCalledWith(
    expect.objectContaining({ Filter: 'email = "user@example.com"' })
  );
  expect(AdminLinkProviderForUserCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      DestinationUser: { ProviderName: "Cognito", ProviderAttributeValue: "existingCognitoUser" },
      SourceUser: { ProviderName: "Google", ProviderAttributeName: "Cognito_Subject", ProviderAttributeValue: "106123456789" },
    })
  );
  expect(result.response.autoConfirmUser).toBe(true);
  expect(result.response.autoVerifyEmail).toBe(true);
});

test("auto-confirms new user when no existing user found", async () => {
  mockSend.mockResolvedValueOnce({ Users: [] });

  const result = await handler(makeEvent());

  expect(AdminLinkProviderForUserCommand).not.toHaveBeenCalled();
  expect(result.response.autoConfirmUser).toBe(true);
  expect(result.response.autoVerifyEmail).toBe(true);
});

test("skips non-external-provider triggers", async () => {
  const result = await handler(makeEvent({ triggerSource: "PreSignUp_SignUp" }));

  expect(mockSend).not.toHaveBeenCalled();
  expect(result.response).toEqual({});
});

test("skips when no email in attributes", async () => {
  const result = await handler(
    makeEvent({ request: { userAttributes: {} } })
  );

  expect(mockSend).not.toHaveBeenCalled();
});

test("handles Apple userName format", async () => {
  mockSend
    .mockResolvedValueOnce({ Users: [{ Username: "existingUser" }] })
    .mockResolvedValueOnce({});

  await handler(makeEvent({ userName: "SignInWithApple_000123.abc.def" }));

  expect(AdminLinkProviderForUserCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      SourceUser: expect.objectContaining({
        ProviderName: "SignInWithApple",
        ProviderAttributeValue: "000123.abc.def",
      }),
    })
  );
});
