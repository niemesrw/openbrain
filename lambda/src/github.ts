import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyAuth } from "./auth/verify";
import {
  handleGitHubConnect,
  handleGitHubDisconnect,
  handleGitHubInstallations,
} from "./handlers/github-connect";
import { handleAgentWizard, handleUpdateAgent } from "./handlers/agent-wizard";

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

    let body: { installationId?: unknown };
    try {
      body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }

    const { installationId: rawId } = body;

    // Accept string or number — GitHub sends a numeric ID in the redirect URL.
    const installationId =
      typeof rawId === "string" && /^\d+$/.test(rawId)
        ? rawId
        : typeof rawId === "number" && Number.isInteger(rawId)
        ? String(rawId)
        : null;

    if (!installationId) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "installationId (string or integer) is required" }),
      };
    }

    try {
      const result = await handleGitHubConnect(
        { installationId },
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

  // DELETE /github/installations/{installationId} — unlink a GitHub App installation
  if (method === "DELETE" && path.startsWith("/github/installations/")) {
    const installationId = path.slice("/github/installations/".length);

    if (!installationId) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "installationId is required" }),
      };
    }

    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const result = await handleGitHubDisconnect(installationId, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
        return {
          statusCode: 404,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Installation not found or not owned by you" }),
        };
      }
      console.error(
        "GitHub disconnect error:",
        e instanceof Error ? e.message : String(e)
      );
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // POST /github/agent-wizard — create a fully configured agent repo from template
  if (method === "POST" && path === "/github/agent-wizard") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }

    try {
      const result = await handleAgentWizard(
        {
          name: body.name as string,
          schedule: body.schedule as string | undefined,
          systemPrompt: body.systemPrompt as string | undefined,
          userPrompt: body.userPrompt as string | undefined,
          model: body.model as string | undefined,
        },
        user
      );
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error(
        "Agent wizard error:",
        e instanceof Error ? e.message : String(e)
      );
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: e instanceof Error ? e.message : "Agent wizard failed",
        }),
      };
    }
  }

  // PUT /github/agent-wizard — update an existing agent's config
  if (method === "PUT" && path === "/github/agent-wizard") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }

    try {
      const result = await handleUpdateAgent(
        {
          name: body.name as string,
          schedule: body.schedule as string | undefined,
          systemPrompt: body.systemPrompt as string | undefined,
          userPrompt: body.userPrompt as string | undefined,
          model: body.model as string | undefined,
        },
        user
      );
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify(result),
      };
    } catch (e) {
      console.error(
        "Agent update error:",
        e instanceof Error ? e.message : String(e)
      );
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: e instanceof Error ? e.message : "Agent update failed",
        }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Not found" }),
  };
}
