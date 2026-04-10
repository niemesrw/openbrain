import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { verifyAuth } from "./auth/verify";
import { executeTool } from "./tool-executor";
import { handleInsight } from "./handlers/insight";
import { handleAppleNativeAuth, type AppleNativeAuthRequest } from "./handlers/apple-native-auth";
import type { UserContext } from "./types";

// --- Tool registration ---

const THOUGHT_TYPE_ENUM = z.enum(["observation", "task", "idea", "reference", "person_note", "workflow"]);

const SCOPE_ENUM = z.enum(["private", "shared"]).default("private")
  .describe("Scope: private (default, only you), shared (public feed)");

const READ_SCOPE_ENUM = z.enum(["private", "shared", "all"]).default("private")
  .describe("Scope: private (default), shared (public feed), all (both)");

const FORMAT_ENUM = z.enum(["json"]).optional()
  .describe("Response format: json; omit for plain text");

export function createMcpServer(user: UserContext): McpServer {
  const server = new McpServer({ name: "open-brain", version: "2.0.0" });

  server.registerTool("search_thoughts", {
    description: "Search your brain by meaning. Uses semantic similarity to find relevant thoughts regardless of exact keywords.",
    inputSchema: {
      query: z.string().describe("What you're looking for — natural language"),
      threshold: z.number().default(0.5).describe("Similarity threshold 0-1 (lower = broader results)"),
      limit: z.number().default(10).describe("Max results to return"),
      type: THOUGHT_TYPE_ENUM.optional().describe("Filter by thought type"),
      topic: z.string().optional().describe("Filter by topic"),
      scope: READ_SCOPE_ENUM,
      _format: FORMAT_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("search_thoughts", args, user) }],
  }));

  server.registerTool("browse_recent", {
    description: "Browse recent thoughts chronologically. Optionally filter by type or topic.",
    inputSchema: {
      limit: z.number().default(10).describe("Number of recent thoughts"),
      type: THOUGHT_TYPE_ENUM.optional().describe("Filter by thought type"),
      topic: z.string().optional().describe("Filter by topic"),
      scope: READ_SCOPE_ENUM,
      tenant_id: z.string().optional().describe("Filter shared thoughts by tenant (userId). Thoughts without tenant_id are always included for backward compatibility."),
      human_only: z.boolean().optional().describe("When true, exclude thoughts captured by system agents (github, slack, etc.)"),
      _format: FORMAT_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("browse_recent", args, user) }],
  }));

  server.registerTool("stats", {
    description: "Get an overview of your brain — total thoughts, breakdown by type, top topics, and people mentioned.",
    inputSchema: {
      _format: FORMAT_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("stats", args, user) }],
  }));

  server.registerTool("capture_thought", {
    description: "Save a new thought to your brain. Automatically generates embedding and extracts metadata.",
    inputSchema: {
      text: z.string().describe("The thought to capture"),
      scope: SCOPE_ENUM,
      type: THOUGHT_TYPE_ENUM.optional().describe("Optional explicit type override — overrides the AI-chosen type when provided"),
      media_url: z.string().url().refine(v => /^https?:/.test(v), { message: "media_url must use http or https" }).optional().describe("Optional URL to associated media (image, video, audio, etc.)"),
      source_url: z.string().url().refine(v => /^https?:/.test(v), { message: "source_url must use http or https" }).optional().describe("Source URL of the article or page being captured — og:image is automatically extracted and stored as media_url"),
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("capture_thought", args, user) }],
  }));

  // --- Tools restricted to human sessions (JWT auth) only ---
  // Agents get search, browse, capture, stats, heartbeat, and bus_activity.
  // Destructive/admin tools are withheld to limit prompt injection blast radius.
  if (!user.agentName) {
    server.registerTool("update_thought", {
      description: "Update an existing thought by ID. Re-embeds the new text and refreshes metadata. The thought ID is returned by browse_recent and search_thoughts.",
      inputSchema: {
        id: z.string().describe("The vector key (ID) of the thought to update"),
        text: z.string().describe("The new text content for the thought"),
        scope: SCOPE_ENUM,
        media_url: z.string().url().refine(v => /^https?:/.test(v), { message: "media_url must use http or https" }).optional().describe("Optional URL to associated media (image, video, audio, etc.)"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("update_thought", args, user) }],
    }));

    server.registerTool("delete_thought", {
      description: "Delete a thought by ID. The thought ID is returned by browse_recent and search_thoughts.",
      inputSchema: {
        id: z.string().describe("The vector key (ID) of the thought to delete"),
        scope: SCOPE_ENUM,
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("delete_thought", args, user) }],
    }));

    server.registerTool("create_agent", {
      description: "Create an API key for an AI agent. Returns the key and MCP config snippets for Claude Code, Claude Desktop, etc.",
      inputSchema: {
        name: z.string().describe("Agent name (alphanumeric, hyphens, underscores). e.g. 'claude-code', 'chatgpt'"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("create_agent", args, user) }],
    }));

    server.registerTool("list_agents", {
      description: "List all your registered AI agents and their creation dates.",
      inputSchema: {
        _format: FORMAT_ENUM,
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("list_agents", args, user) }],
    }));

    server.registerTool("revoke_agent", {
      description: "Revoke an agent's API key. The key will immediately stop working.",
      inputSchema: {
        name: z.string().describe("The agent name to revoke"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("revoke_agent", args, user) }],
    }));

    server.registerTool("rotate_agent_key", {
      description: "Rotate an agent's API key. Generates a new key; the old key may briefly continue to work while the change propagates.",
      inputSchema: {
        name: z.string().describe("The agent name whose key to rotate"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("rotate_agent_key", args, user) }],
    }));

    server.registerTool("github_label", {
      description: "Add, replace, or remove labels on a GitHub issue or pull request.",
      inputSchema: {
        owner: z.string().describe("GitHub org or user login (must match a connected installation)"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().positive().describe("Issue or PR number"),
        labels: z.array(z.string()).min(1).describe("Label names to add, set, or remove"),
        action: z.enum(["add", "set", "remove"]).default("add").describe("add (append), set (replace all), or remove"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("github_label", args, user) }],
    }));

    server.registerTool("github_comment", {
      description: "Post a comment on a GitHub issue or pull request.",
      inputSchema: {
        owner: z.string().describe("GitHub org or user login (must match a connected installation)"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().positive().describe("Issue or PR number"),
        body: z.string().describe("Comment body (Markdown supported)"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("github_comment", args, user) }],
    }));

    server.registerTool("github_close", {
      description: "Close a GitHub issue or pull request.",
      inputSchema: {
        owner: z.string().describe("GitHub org or user login (must match a connected installation)"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().positive().describe("Issue or PR number"),
        state_reason: z.enum(["completed", "not_planned"]).default("completed").describe("Reason for closing: completed or not_planned"),
      },
    }, async (args) => ({
      content: [{ type: "text" as const, text: await executeTool("github_close", args, user) }],
    }));
  }

  server.registerTool("agent_heartbeat", {
    description: "Report this agent's current status. Call periodically (e.g. every minute) so the dashboard can show real-time agent health.",
    inputSchema: {
      status: z.enum(["idle", "working", "error"]).describe("Current agent status"),
      message: z.string().optional().describe("Optional status message (e.g. current task description or error detail)"),
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("agent_heartbeat", args, user) }],
  }));

  server.registerTool("bus_activity", {
    description: "Monitor the public feed — recent shared thoughts grouped by contributor, activity counts, and timeline.",
    inputSchema: {
      hours: z.number().default(24).describe("Look back this many hours (default 24)"),
      agent: z.string().optional().describe("Filter to a specific agent name"),
      limit: z.number().default(50).describe("Max thoughts to return (default 50)"),
      tenant_id: z.string().optional().describe("Filter shared thoughts by tenant (userId)."),
      _format: FORMAT_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("bus_activity", args, user) }],
  }));

  return server;
}

// --- Lambda ↔ Fetch API adapters ---

function eventToRequest(event: APIGatewayProxyEventV2): Request {
  const method = event.requestContext.http.method;
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${event.requestContext.domainName}${event.rawPath}${qs}`;

  const headers = new Headers(
    Object.entries(event.headers ?? {}).filter(([, v]) => v !== undefined) as [string, string][]
  );

  // API GW v2 separates cookies from headers — merge them back in
  if (event.cookies && event.cookies.length > 0) {
    const incoming = headers.get("cookie");
    const merged = [incoming, event.cookies.join("; ")].filter(Boolean).join("; ");
    headers.set("cookie", merged);
  }

  const body =
    event.body && method !== "GET" && method !== "HEAD"
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64") // keep as bytes; avoid corrupt non-UTF8 payloads
        : event.body
      : undefined;

  return new Request(url, { method, headers, body });
}

async function responseToResult(response: Response): Promise<APIGatewayProxyResultV2> {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      // API GW v2 requires multi-value Set-Cookie in the cookies array
      cookies.push(value);
    } else {
      headers[key] = value;
    }
  });

  const result: APIGatewayProxyResultV2 = {
    statusCode: response.status,
    headers,
    body: await response.text(),
  };
  if (cookies.length > 0) result.cookies = cookies;
  return result;
}

// --- Lambda handler ---

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;

  // Health check — GET with no auth required
  if (method === "GET" && event.rawPath === "/health") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok", name: "open-brain-mcp" }),
    };
  }

  // Auth config — returns Cognito domain + client IDs for mobile/CLI auth flows
  if (method === "GET" && event.rawPath === "/auth/config") {
    const cognitoDomain = process.env.COGNITO_DOMAIN;
    const clientId = process.env.COGNITO_CLI_CLIENT_ID;
    if (!cognitoDomain || !clientId) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Auth configuration unavailable" }),
      };
    }
    const body: Record<string, string> = { cognitoDomain, clientId };
    const mobileClientId = process.env.COGNITO_MOBILE_CLIENT_ID;
    if (mobileClientId) body.mobileClientId = mobileClientId;
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  // Native Apple sign-in — exchanges Apple identity token for Cognito tokens
  if (method === "POST" && event.rawPath === "/auth/apple-token") {
    let body: unknown;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Malformed JSON" }),
      };
    }

    try {
      const result = await handleAppleNativeAuth(body as AppleNativeAuthRequest);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Apple native auth error:", message);
      const isAuthError =
        message === "identityToken is required" ||
        message === "No email in Apple identity token" ||
        message === "Email not verified" ||
        message === "Apple signing key not found" ||
        message.startsWith("Invalid ") ||
        message.startsWith("Token expired");
      const isConfigError =
        message === "APPLE_BUNDLE_IDS_PARAM must be configured" ||
        message === "APPLE_BUNDLE_IDS parameter is empty";
      const statusCode = isConfigError ? 503 : isAuthError ? 401 : 500;
      const error = isConfigError
        ? "Apple sign-in is not configured"
        : isAuthError ? "Unauthorized" : "Internal server error";
      return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error }),
      };
    }
  }

  // Insight endpoint — GET /insight, auth required
  if (method === "GET" && event.rawPath === "/insight") {
    let user: UserContext;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    try {
      const insight = await handleInsight(user);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ insight }),
      };
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error("Insight error:", e.message, e.stack);
      } else {
        console.error("Insight error (non-Error):", String(e));
      }
      return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ insight: null }) };
    }
  }

  // Health check — GET /mcp with no auth required
  if (method === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok", name: "open-brain-mcp" }),
    };
  }

  // Verify auth directly (not via API Gateway authorizer) so we control the 401 response
  let user: UserContext;
  try {
    user = await verifyAuth(event.headers ?? {});
  } catch {
    const domain = process.env.CUSTOM_DOMAIN || event.requestContext.domainName;
    return {
      statusCode: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="https://${domain}/.well-known/oauth-protected-resource"`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unauthorized" } }),
    };
  }

  // Create a fresh server + transport per request (stateless)
  const server = createMcpServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,      // return JSON, not SSE (Lambda can't stream)
  });

  await server.connect(transport);

  const request = eventToRequest(event);
  const response = await transport.handleRequest(request);
  return responseToResult(response);
}
