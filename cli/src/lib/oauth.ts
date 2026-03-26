import * as http from "http";
import * as crypto from "crypto";
import { exec } from "child_process";
import { saveCredentials } from "./config";
import { printInfo, printSuccess, printError } from "./display";

const OAUTH_PORT = 19836;
const OAUTH_TIMEOUT_MS = 120_000;

interface OAuthConfig {
  cognitoDomain: string;
  clientId: string;
  region: string;
  apiUrl: string;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      printInfo(`Could not open browser automatically. Open this URL manually:\n  ${url}`);
    }
  });
}

async function exchangeCodeForTokens(
  cognitoDomain: string,
  clientId: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const tokenUrl = `${cognitoDomain}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function oauthLogin(config: OAuthConfig): Promise<void> {
  const { cognitoDomain, clientId, region, apiUrl } = config;
  const redirectUri = `http://localhost:${OAUTH_PORT}/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = generatePkce();

  const authorizeUrl =
    `${cognitoDomain}/oauth2/authorize?` +
    new URLSearchParams({
      identity_provider: "Google",
      redirect_uri: redirectUri,
      response_type: "code",
      client_id: clientId,
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Login failed</h2><p>You can close this tab.</p></body></html>");
        cleanup();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Invalid state</h2><p>You can close this tab.</p></body></html>");
        cleanup();
        reject(new Error("OAuth state mismatch — possible CSRF attack"));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h2>Missing code</h2><p>You can close this tab.</p></body></html>");
        cleanup();
        reject(new Error("No authorization code received"));
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(
          cognitoDomain,
          clientId,
          code,
          verifier,
          redirectUri,
        );

        saveCredentials({
          apiUrl,
          region,
          clientId,
          cognitoDomain,
          accessToken: tokens.access_token,
          idToken: tokens.id_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        });

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h2>Login successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>"
        );
        cleanup();
        printSuccess("Logged in with Google.");
        resolve();
      } catch (e: any) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`<html><body><h2>Login failed</h2><p>${e.message}</p></body></html>`);
        cleanup();
        reject(e);
      }
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("OAuth login timed out — no callback received within 2 minutes"));
    }, OAUTH_TIMEOUT_MS);

    let closed = false;
    function cleanup() {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      if (server.listening) server.close();
    }

    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      printInfo("Opening browser for Google sign-in...");
      openBrowser(authorizeUrl);
      printInfo(`Waiting for callback on http://localhost:${OAUTH_PORT}/callback ...`);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      cleanup();
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${OAUTH_PORT} is in use. Close the process using it and try again.`));
      } else {
        reject(err);
      }
    });
  });
}
