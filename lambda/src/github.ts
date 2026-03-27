import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyAuth } from "./auth/verify";
import {
  handleGitHubConnect,
  handleGitHubInstallations,
} from "./handlers/github-connect";

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

  // POST /github/connect — register a GitHub App installation for the authenticated user
  if (method === "POST" && path === "/github/connect") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: { installationId?: unknown; accountLogin?: unknown; accountType?: unknown };
    try {
      body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }

    const { installationId: rawId, accountLogin, accountType } = body;

    // Accept string or number from the client (GitHub sends a numeric ID in the
    // redirect URL query param, but clients may serialise it as either type).
    // Standardise to string for storage.
    const installationId =
      typeof rawId === "string" && /^\d+$/.test(rawId)
        ? rawId
        : typeof rawId === "number" && Number.isInteger(rawId)
        ? String(rawId)
        : null;

    if (
      !installationId ||
      typeof accountLogin !== "string" ||
      (accountType !== "User" && accountType !== "Organization")
    ) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error:
            "installationId (string or integer), accountLogin (string), and accountType (User|Organization) are required",
        }),
      };
    }

    try {
      const result = await handleGitHubConnect(
        { installationId, accountLogin, accountType },
        user
      );
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      if (e instanceof Error && (e as Error & { statusCode?: number }).statusCode === 409) {
        return {
          statusCode: 409,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: e.message }),
        };
      }
      console.error(
        "GitHub connect error:",
        e instanceof Error ? e.message : String(e)
      );
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // GET /github/installations — list GitHub App installations for the authenticated user
  if (method === "GET" && path === "/github/installations") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleGitHubInstallations(user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error(
        "GitHub installations error:",
        e instanceof Error ? e.message : String(e)
      );
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
