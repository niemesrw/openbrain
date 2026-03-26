import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { extractUserContext } from "./auth/context";
import { executeTool } from "./tool-executor";
import type { UserContext } from "./types";

// --- Tool registration ---

const SCOPE_ENUM = z.enum(["private", "shared"]).default("private")
  .describe("Scope: private (default, only you), shared (public feed)");

const READ_SCOPE_ENUM = z.enum(["private", "shared", "all"]).default("private")
  .describe("Scope: private (default), shared (public feed), all (both)");

function createMcpServer(user: UserContext): McpServer {
  const server = new McpServer({ name: "open-brain", version: "2.0.0" });

  server.registerTool("search_thoughts", {
    description: "Search your brain by meaning. Uses semantic similarity to find relevant thoughts regardless of exact keywords.",
    inputSchema: {
      query: z.string().describe("What you're looking for — natural language"),
      threshold: z.number().default(0.5).describe("Similarity threshold 0-1 (lower = broader results)"),
      limit: z.number().default(10).describe("Max results to return"),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic"),
      scope: READ_SCOPE_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("search_thoughts", args, user) }],
  }));

  server.registerTool("browse_recent", {
    description: "Browse recent thoughts chronologically. Optionally filter by type or topic.",
    inputSchema: {
      limit: z.number().default(10).describe("Number of recent thoughts"),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic"),
      scope: READ_SCOPE_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("browse_recent", args, user) }],
  }));

  server.registerTool("stats", {
    description: "Get an overview of your brain — total thoughts, breakdown by type, top topics, and people mentioned.",
    inputSchema: {},
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("stats", args, user) }],
  }));

  server.registerTool("capture_thought", {
    description: "Save a new thought to your brain. Automatically generates embedding and extracts metadata.",
    inputSchema: {
      text: z.string().describe("The thought to capture"),
      scope: SCOPE_ENUM,
    },
  }, async (args) => ({
    content: [{ type: "text" as const, text: await executeTool("capture_thought", args, user) }],
  }));

  server.registerTool("update_thought", {
    description: "Update an existing thought by ID. Re-embeds the new text and refreshes metadata. The thought ID is returned by browse_recent and search_thoughts.",
    inputSchema: {
      id: z.string().describe("The vector key (ID) of the thought to update"),
      text: z.string().describe("The new text content for the thought"),
      scope: SCOPE_ENUM,
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
    inputSchema: {},
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

  server.registerTool("bus_activity", {
    description: "Monitor the public feed — recent shared thoughts grouped by contributor, activity counts, and timeline.",
    inputSchema: {
      hours: z.number().default(24).describe("Look back this many hours (default 24)"),
      agent: z.string().optional().describe("Filter to a specific agent name"),
      limit: z.number().default(50).describe("Max thoughts to return (default 50)"),
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
  if (method === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok", name: "open-brain-mcp" }),
    };
  }

  // Extract user from custom authorizer context
  let user: UserContext;
  try {
    user = extractUserContext(event);
  } catch {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
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
