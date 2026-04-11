import * as crypto from "crypto";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminLinkProviderForUserCommand,
  AdminSetUserPasswordCommand,
  MessageActionType,
} from "@aws-sdk/client-cognito-identity-provider";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const cognito = new CognitoIdentityProviderClient({});
const ssm = new SSMClient({});

// Read env vars lazily so tests can set them in beforeEach
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}
function getUserPoolId() { return getRequiredEnv("USER_POOL_ID"); }
function getMobileClientId() { return getRequiredEnv("COGNITO_MOBILE_CLIENT_ID"); }

// Cache SSM value for the lifetime of the Lambda execution environment
let bundleIdsCache: string[] | null = null;
async function getAppleBundleIds(): Promise<string[]> {
  if (bundleIdsCache) return bundleIdsCache;
  const paramName = process.env.APPLE_BUNDLE_IDS_PARAM;
  if (!paramName) throw new Error("APPLE_BUNDLE_IDS_PARAM must be configured");
  const res = await ssm.send(new GetParameterCommand({ Name: paramName }));
  const ids = (res.Parameter?.Value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("APPLE_BUNDLE_IDS parameter is empty");
  bundleIdsCache = ids;
  return ids;
}

// Exported for tests to reset the cache
export function _resetBundleIdsCache() { bundleIdsCache = null; }

const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

// Email format validation — same pattern as cognito-pre-signup.ts
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;

// --- Apple JWKS cache ---

interface AppleJWK {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

let jwksCache: AppleJWK[] | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600_000; // 1 hour

async function getAppleJWKS(): Promise<AppleJWK[]> {
  if (jwksCache && Date.now() - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }
  const res = await fetch(APPLE_JWKS_URL);
  if (!res.ok) throw new Error("Failed to fetch Apple JWKS");
  const data = (await res.json()) as { keys: AppleJWK[] };
  jwksCache = data.keys;
  jwksCacheTime = Date.now();
  return data.keys;
}

// --- JWT verification ---

interface AppleTokenPayload {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  email_verified?: string | boolean;
  nonce?: string;
}

function base64UrlDecode(str: string): Buffer {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  return Buffer.from(padded, "base64");
}

async function verifyAppleToken(identityToken: string): Promise<AppleTokenPayload> {
  const parts = identityToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  let header: { kid: string; alg: string };
  let payload: AppleTokenPayload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString());
    payload = JSON.parse(base64UrlDecode(parts[1]).toString());
  } catch {
    throw new Error("Invalid token format");
  }

  // Validate header
  if (header.alg !== "RS256") throw new Error("Invalid algorithm");

  // Validate claims before signature (fast-fail)
  if (payload.iss !== APPLE_ISSUER) throw new Error("Invalid issuer");
  if (!(await getAppleBundleIds()).includes(payload.aud)) throw new Error("Invalid audience");
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");

  // Require verified email when present
  if (payload.email && payload.email_verified !== "true" && payload.email_verified !== true) {
    throw new Error("Email not verified");
  }

  // Verify signature
  const keys = await getAppleJWKS();
  const key = keys.find((k) => k.kid === header.kid && k.alg === "RS256" && k.use === "sig");
  if (!key) {
    // Key may have rotated — bust cache and retry once
    jwksCache = null;
    const freshKeys = await getAppleJWKS();
    const freshKey = freshKeys.find((k) => k.kid === header.kid && k.alg === "RS256" && k.use === "sig");
    if (!freshKey) throw new Error("Apple signing key not found");
    return verifyWithKey(freshKey, parts, payload);
  }

  return verifyWithKey(key, parts, payload);
}

function verifyWithKey(
  key: AppleJWK,
  parts: string[],
  payload: AppleTokenPayload,
): AppleTokenPayload {
  const publicKey = crypto.createPublicKey({
    key: { kty: key.kty, n: key.n, e: key.e },
    format: "jwk",
  });

  const signatureInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);

  const isValid = crypto.createVerify("RSA-SHA256").update(signatureInput).verify(publicKey, signature);
  if (!isValid) throw new Error("Invalid token signature");

  return payload;
}

// --- Cognito user management ---

interface FoundUser {
  username: string;
  status: string;
  identities?: string; // JSON string of linked providers
}

async function findUserByAppleSub(appleSub: string): Promise<FoundUser | null> {
  // Search for a user that already has this Apple identity linked.
  // Apple identities can exist as standalone federated users (SignInWithApple_<sub>)
  // or as linked identities on another user. Cognito's ListUsers filter can't
  // search inside the "identities" attribute, so we check both:
  // 1. Standalone federated user by username
  // 2. Linked identity by scanning users' identities JSON

  // Try standalone federated user first (fast path)
  const standaloneResult = await cognito.send(
    new ListUsersCommand({
      UserPoolId: getUserPoolId(),
      Filter: `username = "SignInWithApple_${appleSub}"`,
      Limit: 1,
    }),
  );
  const standalone = standaloneResult.Users?.[0];
  if (standalone?.Username) {
    return {
      username: standalone.Username,
      status: standalone.UserStatus ?? "UNKNOWN",
      identities: standalone.Attributes?.find((a) => a.Name === "identities")?.Value,
    };
  }

  // Scan for linked identity (needed when Apple is linked to a Google/native user)
  let paginationToken: string | undefined;
  do {
    const page = await cognito.send(
      new ListUsersCommand({
        UserPoolId: getUserPoolId(),
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );
    for (const user of page.Users ?? []) {
      const identities = user.Attributes?.find((a) => a.Name === "identities")?.Value;
      if (identities?.includes(`"userId":"${appleSub}"`)) {
        return {
          username: user.Username!,
          status: user.UserStatus ?? "UNKNOWN",
          identities,
        };
      }
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);

  return null;
}

async function findUserByEmail(email: string): Promise<FoundUser | null> {
  // Validate email format before interpolating into filter (same as cognito-pre-signup.ts)
  if (!EMAIL_RE.test(email)) return null;

  const result = await cognito.send(
    new ListUsersCommand({
      UserPoolId: getUserPoolId(),
      Filter: `email = "${email}"`,
      Limit: 1,
    }),
  );
  const user = result.Users?.[0];
  if (!user?.Username) return null;
  return {
    username: user.Username,
    status: user.UserStatus ?? "UNKNOWN",
    identities: user.Attributes?.find((a) => a.Name === "identities")?.Value,
  };
}

/**
 * Move a user from FORCE_CHANGE_PASSWORD to CONFIRMED.
 * AdminCreateUser leaves users in FORCE_CHANGE_PASSWORD, but CUSTOM_AUTH
 * requires CONFIRMED status. Setting a random permanent password confirms
 * the user without exposing any real credential (auth is token-based).
 */
async function setRandomPassword(username: string): Promise<string> {
  const password = crypto.randomBytes(32).toString("base64url") + "!Aa1";
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: getUserPoolId(),
      Username: username,
      Password: password,
      Permanent: true,
    }),
  );
  return password;
}

async function createUserForApple(
  appleSub: string,
  email: string,
  fullName?: { givenName?: string; familyName?: string },
): Promise<string> {
  const displayName = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ") || undefined;

  const attrs = [
    { Name: "email", Value: email },
    { Name: "email_verified", Value: "true" },
  ];
  if (displayName) {
    attrs.push({ Name: "preferred_username", Value: displayName });
  }

  const result = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: getUserPoolId(),
      Username: email,
      UserAttributes: attrs,
      MessageAction: MessageActionType.SUPPRESS,
    }),
  );

  const username = result.User!.Username!;
  await setRandomPassword(username);

  // Link Apple identity to this user
  await cognito.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: getUserPoolId(),
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: username,
      },
      SourceUser: {
        ProviderName: "SignInWithApple",
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: appleSub,
      },
    }),
  );

  return username;
}

async function linkAppleToExistingUser(username: string, appleSub: string, identities?: string): Promise<void> {
  if (identities?.includes(`"providerName":"SignInWithApple"`)) {
    return; // Already linked
  }

  try {
    await cognito.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: getUserPoolId(),
        DestinationUser: {
          ProviderName: "Cognito",
          ProviderAttributeValue: username,
        },
        SourceUser: {
          ProviderName: "SignInWithApple",
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: appleSub,
        },
      }),
    );
  } catch (err: unknown) {
    // Apple sub may already be linked to another user (e.g. an old
    // EXTERNAL_PROVIDER user from a prior partial conversion). The link is
    // not required for CUSTOM_AUTH token issuance, so skip gracefully.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already linked")) {
      console.warn("Apple identity already linked to another user, skipping:", message);
      return;
    }
    throw err;
  }
}

/**
 * Promote an EXTERNAL_PROVIDER user to support password-based auth in-place.
 * AdminSetUserPassword on an EXTERNAL_PROVIDER user converts it to CONFIRMED
 * while preserving the same `sub` — so brain data stays linked to the user.
 */
async function promoteExternalUser(username: string): Promise<void> {
  await setRandomPassword(username);
}

/**
 * Issue Cognito tokens by setting a random password and authenticating with it.
 * The password is ephemeral — generated per-request, never stored or exposed.
 */
async function issueTokens(username: string): Promise<{
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const password = await setRandomPassword(username);

  const authResult = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: getUserPoolId(),
      ClientId: getMobileClientId(),
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );

  const result = authResult.AuthenticationResult;
  if (!result?.IdToken || !result.AccessToken || !result.RefreshToken) {
    throw new Error("Cognito did not return complete tokens");
  }

  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn ?? 3600,
  };
}

// --- Handler ---

export interface AppleNativeAuthRequest {
  identityToken: string;
  fullName?: { givenName?: string; familyName?: string };
}

export async function handleAppleNativeAuth(body: AppleNativeAuthRequest): Promise<{
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  if (!body.identityToken) {
    throw new Error("identityToken is required");
  }

  // 1. Verify Apple identity token
  const payload = await verifyAppleToken(body.identityToken);

  // Only trust email from the verified token — never from the client body
  const email = payload.email;
  if (!email) {
    throw new Error("No email in Apple identity token");
  }

  // 2. Find or create the Cognito user
  // Try Apple sub first (handles "Hide My Email" where the private relay
  // email won't match the user's real email on file), then fall back to email.
  const existing = await findUserByAppleSub(payload.sub) ?? await findUserByEmail(email);

  let username: string;
  if (existing) {
    username = existing.username;
    if (existing.status === "EXTERNAL_PROVIDER") {
      // Promote in-place so ADMIN_USER_PASSWORD_AUTH works while preserving
      // the same sub/userId (and thus the user's brain data).
      await promoteExternalUser(username);
    } else if (existing.status === "FORCE_CHANGE_PASSWORD") {
      await setRandomPassword(username);
    }
    await linkAppleToExistingUser(username, payload.sub, existing.identities);
  } else {
    username = await createUserForApple(payload.sub, email, body.fullName);
  }

  // 3. Issue Cognito tokens via custom auth (no password mutation)
  return issueTokens(username);
}
