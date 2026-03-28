import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyAuth } from "./auth/verify";
import {
  handleSlackInstall,
  handleSlackCallback,
  handleSlackInstallations,
  handleSlackDisconnect,
} from "./handlers/slack-connect";

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

  // GET /slack/install — generate Slack OAuth install URL for authenticated user
  if (method === "GET" && path === "/slack/install") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleSlackInstall(user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Slack install error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // POST /slack/callback — exchange OAuth code for tokens (POST keeps code out of server logs)
  if (method === "POST" && path === "/slack/callback") {
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
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "code is required" }),
      };
    }
    if (!state) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "state is required" }),
      };
    }

    try {
      const result = await handleSlackCallback(code, state, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Slack callback error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      };
    }
  }

  // GET /slack/installations — list connected Slack workspaces for the user
  if (method === "GET" && path === "/slack/installations") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleSlackInstallations(user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Slack installations error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // DELETE /slack/installations/{teamId} — unlink a Slack workspace
  if (method === "DELETE" && path.startsWith("/slack/installations/")) {
    const teamId = path.slice("/slack/installations/".length);

    if (!teamId) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "teamId is required" }),
      };
    }

    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleSlackDisconnect(teamId, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error("Slack disconnect error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Not found" }),
  };
}
