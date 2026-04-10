import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const API_URL = import.meta.env.VITE_API_URL;
const USER_POOL_ID = import.meta.env.VITE_USER_POOL_ID;
const WEB_CLIENT_ID = import.meta.env.VITE_WEB_CLIENT_ID;
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;

if (!API_URL || !USER_POOL_ID || !WEB_CLIENT_ID) {
  throw new Error(
    "Missing required env vars: VITE_API_URL, VITE_USER_POOL_ID, VITE_WEB_CLIENT_ID. " +
      "Create a web/.env file with these values."
  );
}

const userPool = new CognitoUserPool({
  UserPoolId: USER_POOL_ID,
  ClientId: WEB_CLIENT_ID,
});

export function getApiUrl(): string {
  return API_URL;
}

export function getCurrentUser(): CognitoUser | null {
  return userPool.getCurrentUser();
}

export function getSession(): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const user = getCurrentUser();
    if (!user) return reject(new Error("Not logged in"));
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session) return reject(err || new Error("No session"));
      resolve(session);
    });
  });
}

export async function getIdToken(): Promise<string> {
  const session = await getSession();
  return session.getIdToken().getJwtToken();
}

export function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const attrs = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
      new CognitoUserAttribute({
        Name: "preferred_username",
        Value: displayName,
      }),
    ];
    userPool.signUp(email, password, attrs, [], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function signIn(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });
    user.authenticateUser(authDetails, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  const user = getCurrentUser();
  if (user) user.signOut();
}

// --- Google OAuth ---

const OAUTH_STATE_KEY = "oauth_state";

function getRedirectUri(): string {
  return `${window.location.origin}/callback`;
}

function generateOAuthState(): string {
  const array = new Uint8Array(16);
  window.crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

type OAuthProvider = "Google" | "SignInWithApple";

function signInWithProvider(provider: OAuthProvider): void {
  if (!COGNITO_DOMAIN) {
    throw new Error("VITE_COGNITO_DOMAIN is required for OAuth sign-in");
  }
  const state = generateOAuthState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    identity_provider: provider,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    client_id: WEB_CLIENT_ID,
    scope: "openid email profile",
    state,
  });
  window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}

export function signInWithGoogle(): void {
  signInWithProvider("Google");
}

export function signInWithApple(): void {
  signInWithProvider("SignInWithApple");
}

export async function handleOAuthCallback(
  code: string,
  state: string | null
): Promise<void> {
  if (!COGNITO_DOMAIN) {
    throw new Error("VITE_COGNITO_DOMAIN is required for OAuth callback");
  }

  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  if (!expectedState) {
    throw new Error("OAuth state not found in session — try signing in again");
  }
  if (!state) {
    throw new Error("OAuth state missing from callback URL");
  }
  if (expectedState !== state) {
    throw new Error("OAuth state mismatch — possible CSRF attempt");
  }

  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: WEB_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status})`);
  }

  const tokens = await res.json();

  // Store tokens so amazon-cognito-identity-js picks them up as a valid session
  const idPayload = JSON.parse(
    decodeBase64Url(tokens.id_token.split(".")[1])
  );
  const username = idPayload["cognito:username"] || idPayload.sub;
  const keyPrefix = `CognitoIdentityServiceProvider.${WEB_CLIENT_ID}`;

  localStorage.setItem(`${keyPrefix}.LastAuthUser`, username);
  localStorage.setItem(`${keyPrefix}.${username}.idToken`, tokens.id_token);
  localStorage.setItem(
    `${keyPrefix}.${username}.accessToken`,
    tokens.access_token
  );
  if (tokens.refresh_token) {
    localStorage.setItem(
      `${keyPrefix}.${username}.refreshToken`,
      tokens.refresh_token
    );
  }

  sessionStorage.removeItem(OAUTH_STATE_KEY);
}
