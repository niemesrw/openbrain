import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyAuth } from "./auth/verify";
import {
  handleGoogleConnect,
  handleGoogleCallback,
  handleGoogleConnections,
  handleGoogleDisconnect,
  handleGoogleSync,
} from "./handlers/google-connect";

const JSON_HEADERS = { "Content-Type": "application/json" };

function unauthorized(): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Unauthorized" }),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // GET /google/connect — generate Google OAuth URL for authenticated user
  if (method === "GET" && path === "/google/connect") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleGoogleConnect(user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Google connect error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // POST /google/callback — exchange OAuth code for tokens (POST keeps code out of server logs)
  if (method === "POST" && path === "/google/callback") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: { code?: string; state?: string };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const { code, state } = body;
    if (!code) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "code is required" }) };
    }
    if (!state) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "state is required" }) };
    }

    try {
      const result = await handleGoogleCallback(code, state, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Google callback error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      };
    }
  }

  // GET /google/connections — list connected Google accounts for the user
  if (method === "GET" && path === "/google/connections") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleGoogleConnections(user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Google connections error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // DELETE /google/connections — disconnect a Google account (email in body, not URL)
  if (method === "DELETE" && path === "/google/connections") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: { email?: string };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const { email } = body;
    if (!email) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "email is required" }) };
    }

    try {
      const result = await handleGoogleDisconnect(email, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Google disconnect error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // POST /google/sync — trigger manual email sync for a connected account
  if (method === "POST" && path === "/google/sync") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: { email?: string };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const { email } = body;
    if (!email) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "email is required" }) };
    }

    try {
      const result = await handleGoogleSync(email, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Google sync error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Not found" }),
  };
}
