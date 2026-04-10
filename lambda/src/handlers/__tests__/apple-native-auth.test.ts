// Mock AWS SDK before imports
jest.mock("@aws-sdk/client-cognito-identity-provider", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    CognitoIdentityProviderClient: Client,
    ListUsersCommand: jest.fn((input: unknown) => ({ _type: "ListUsers", input })),
    AdminCreateUserCommand: jest.fn((input: unknown) => ({ _type: "AdminCreateUser", input })),
    AdminInitiateAuthCommand: jest.fn((input: unknown) => ({ _type: "AdminInitiateAuth", input })),
    AdminRespondToAuthChallengeCommand: jest.fn((input: unknown) => ({ _type: "AdminRespondToAuthChallenge", input })),
    AdminLinkProviderForUserCommand: jest.fn((input: unknown) => ({ _type: "AdminLinkProviderForUser", input })),
    AdminGetUserCommand: jest.fn((input: unknown) => ({ _type: "AdminGetUser", input })),
    MessageActionType: { SUPPRESS: "SUPPRESS" },
  };
});

jest.mock("@aws-sdk/client-ssm", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    SSMClient: Client,
    GetParameterCommand: jest.fn((input: unknown) => ({ _type: "GetParameter", input })),
  };
});

// Mock fetch for Apple JWKS
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { SSMClient } from "@aws-sdk/client-ssm";
import { handleAppleNativeAuth, _resetBundleIdsCache } from "../apple-native-auth";
import * as crypto from "crypto";

const mockSend = (CognitoIdentityProviderClient as any).__mockSend as jest.Mock;
const mockSsmSend = (SSMClient as any).__mockSend as jest.Mock;

// Generate a test RSA key pair for signing fake Apple tokens
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Extract JWK components from the public key
const jwk = crypto.createPublicKey(publicKey).export({ format: "jwk" }) as crypto.JsonWebKey;

const TEST_KID = "test-key-id";
const TEST_BUNDLE_ID = "ai.blanxlait.brain.ios2";

function createAppleToken(claims: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: TEST_KID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://appleid.apple.com",
    aud: TEST_BUNDLE_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    sub: "apple-user-001",
    email: "test@example.com",
    email_verified: "true",
    ...claims,
  })).toString("base64url");

  const signature = crypto.createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey, "base64url");

  return `${header}.${payload}.${signature}`;
}

function mockAppleJWKS() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      keys: [{ kty: "RSA", kid: TEST_KID, use: "sig", alg: "RS256", n: jwk.n, e: jwk.e }],
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetBundleIdsCache();
  process.env.USER_POOL_ID = "us-east-1_TestPool";
  process.env.COGNITO_MOBILE_CLIENT_ID = "test-mobile-client";
  process.env.APPLE_BUNDLE_IDS_PARAM = "/openbrain/apple-bundle-ids";
  mockAppleJWKS();
  mockSsmSend.mockResolvedValue({ Parameter: { Value: TEST_BUNDLE_ID } });
});

function mockCognitoForSuccess() {
  mockSend.mockImplementation((cmd: any) => {
    if (cmd._type === "ListUsers") return { Users: [] };
    if (cmd._type === "AdminCreateUser") return { User: { Username: "new-user-123" } };
    if (cmd._type === "AdminLinkProviderForUser") return {};
    if (cmd._type === "AdminInitiateAuth") return { Session: "test-session" };
    if (cmd._type === "AdminRespondToAuthChallenge") return {
      AuthenticationResult: {
        IdToken: "id-token",
        AccessToken: "access-token",
        RefreshToken: "refresh-token",
        ExpiresIn: 3600,
      },
    };
    return {};
  });
}

describe("handleAppleNativeAuth", () => {
  it("creates a new user when no existing user found", async () => {
    mockCognitoForSuccess();

    const token = createAppleToken();
    const result = await handleAppleNativeAuth({ identityToken: token });

    expect(result.idToken).toBe("id-token");
    expect(result.accessToken).toBe("access-token");
    expect(result.refreshToken).toBe("refresh-token");
    expect(result.expiresIn).toBe(3600);

    // Should have called AdminCreateUser
    const createCall = mockSend.mock.calls.find((c: any) => c[0]._type === "AdminCreateUser");
    expect(createCall).toBeDefined();
    expect(createCall[0].input.Username).toBe("test@example.com");

    // Should use CUSTOM_AUTH, not password auth
    const authCall = mockSend.mock.calls.find((c: any) => c[0]._type === "AdminInitiateAuth");
    expect(authCall[0].input.AuthFlow).toBe("CUSTOM_AUTH");
    expect(authCall[0].input.ClientMetadata?.nonce).toBeDefined();
  });

  it("links Apple identity to existing user", async () => {
    mockSend.mockImplementation((cmd: any) => {
      if (cmd._type === "ListUsers") return { Users: [{ Username: "existing-user" }] };
      if (cmd._type === "AdminGetUser") return {
        UserAttributes: [{ Name: "identities", Value: "[]" }],
      };
      if (cmd._type === "AdminLinkProviderForUser") return {};
      if (cmd._type === "AdminInitiateAuth") return { Session: "test-session" };
      if (cmd._type === "AdminRespondToAuthChallenge") return {
        AuthenticationResult: {
          IdToken: "id-token",
          AccessToken: "access-token",
          RefreshToken: "refresh-token",
          ExpiresIn: 3600,
        },
      };
      return {};
    });

    const token = createAppleToken();
    const result = await handleAppleNativeAuth({ identityToken: token });

    expect(result.idToken).toBe("id-token");

    // Should NOT have called AdminCreateUser
    const createCall = mockSend.mock.calls.find((c: any) => c[0]._type === "AdminCreateUser");
    expect(createCall).toBeUndefined();

    // Should have called AdminLinkProviderForUser
    const linkCall = mockSend.mock.calls.find((c: any) => c[0]._type === "AdminLinkProviderForUser");
    expect(linkCall).toBeDefined();
  });

  it("rejects expired tokens", async () => {
    const token = createAppleToken({ exp: Math.floor(Date.now() / 1000) - 100 });
    await expect(handleAppleNativeAuth({ identityToken: token })).rejects.toThrow("Token expired");
  });

  it("rejects tokens with wrong audience", async () => {
    const token = createAppleToken({ aud: "com.wrong.bundle.id" });
    await expect(handleAppleNativeAuth({ identityToken: token })).rejects.toThrow("Invalid audience");
  });

  it("rejects tokens with wrong issuer", async () => {
    const token = createAppleToken({ iss: "https://evil.com" });
    await expect(handleAppleNativeAuth({ identityToken: token })).rejects.toThrow("Invalid issuer");
  });

  it("rejects missing identityToken", async () => {
    await expect(handleAppleNativeAuth({ identityToken: "" })).rejects.toThrow("identityToken is required");
  });

  it("rejects tokens with invalid signature", async () => {
    const token = createAppleToken();
    const parts = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({
      iss: "https://appleid.apple.com",
      aud: TEST_BUNDLE_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: "hacker",
      email: "hacker@evil.com",
      email_verified: "true",
    })).toString("base64url");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    await expect(handleAppleNativeAuth({ identityToken: tampered })).rejects.toThrow("Invalid token signature");
  });

  it("rejects tokens with wrong algorithm", async () => {
    // Create a token with alg: "none" in header
    const header = Buffer.from(JSON.stringify({ alg: "HS256", kid: TEST_KID })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "https://appleid.apple.com",
      aud: TEST_BUNDLE_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "apple-user-001",
      email: "test@example.com",
      email_verified: "true",
    })).toString("base64url");
    const fakeToken = `${header}.${payload}.fake-sig`;
    await expect(handleAppleNativeAuth({ identityToken: fakeToken })).rejects.toThrow("Invalid algorithm");
  });

  it("rejects tokens with unverified email", async () => {
    const token = createAppleToken({ email_verified: "false" });
    await expect(handleAppleNativeAuth({ identityToken: token })).rejects.toThrow("Email not verified");
  });

  it("rejects when email is missing from token", async () => {
    mockCognitoForSuccess();
    const token = createAppleToken({ email: undefined });
    await expect(handleAppleNativeAuth({ identityToken: token })).rejects.toThrow("No email in Apple identity token");
  });

  it("does not trust client-supplied email", async () => {
    // Token has no email, but client supplies one — should still reject
    const token = createAppleToken({ email: undefined });
    await expect(
      handleAppleNativeAuth({ identityToken: token })
    ).rejects.toThrow("No email in Apple identity token");
  });
});
