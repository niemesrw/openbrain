import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const API_URL = import.meta.env.VITE_API_URL || "";
const USER_POOL_ID = import.meta.env.VITE_USER_POOL_ID || "";
const WEB_CLIENT_ID = import.meta.env.VITE_WEB_CLIENT_ID || "";

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

export async function getAccessToken(): Promise<string> {
  const session = await getSession();
  return session.getAccessToken().getJwtToken();
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
