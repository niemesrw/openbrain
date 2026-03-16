import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { extractUserContext } from "./auth/context";
import { handleSearchThoughts } from "./handlers/search-thoughts";
import { handleBrowseRecent } from "./handlers/browse-recent";
import { handleStats } from "./handlers/stats";
import { handleCaptureThought } from "./handlers/capture-thought";
import { handleUpdateThought } from "./handlers/update-thought";
import { handleDeleteThought } from "./handlers/delete-thought";
import {
  handleCreateAgent,
  handleListAgents,
  handleRevokeAgent,
} from "./handlers/agent-keys";
import { handleBusActivity } from "./handlers/bus-activity";
import type { McpRequest, UserContext } from "./types";

// --- Tool definitions ---

const TOOLS = [
  {
    name: "search_thoughts",
    description:
      "Search your brain by meaning. Uses semantic similarity to find relevant thoughts regardless of exact keywords.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you're looking for — natural language",
        },
        threshold: {
          type: "number",
          description:
            "Similarity threshold 0-1 (lower = broader results)",
          default: 0.5,
        },
        limit: {
          type: "number",
          description: "Max results to return",
          default: 10,
        },
        type: {
          type: "string",
          description:
            "Filter by type: observation, task, idea, reference, person_note",
        },
        topic: { type: "string", description: "Filter by topic" },
        scope: {
          type: "string",
          description:
            "Scope: private (default, your thoughts only), shared (public feed), all (both)",
          default: "private",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_recent",
    description:
      "Browse recent thoughts chronologically. Optionally filter by type or topic.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of recent thoughts",
          default: 10,
        },
        type: {
          type: "string",
          description:
            "Filter by type: observation, task, idea, reference, person_note",
        },
        topic: { type: "string", description: "Filter by topic" },
        scope: {
          type: "string",
          description: "Scope: private (default), shared (public feed), all",
          default: "private",
        },
      },
    },
  },
  {
    name: "stats",
    description:
      "Get an overview of your brain — total thoughts, breakdown by type, top topics, and people mentioned.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "capture_thought",
    description:
      "Save a new thought to your brain. Automatically generates embedding and extracts metadata.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The thought to capture" },
        scope: {
          type: "string",
          description:
            "Scope: private (default, only you can see it), shared (visible on the public feed)",
          default: "private",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "update_thought",
    description:
      "Update an existing thought by ID. Re-embeds the new text and refreshes metadata. The thought ID is returned by browse_recent and search_thoughts when using _format: 'json'.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The vector key (ID) of the thought to update",
        },
        text: {
          type: "string",
          description: "The new text content for the thought",
        },
        scope: {
          type: "string",
          description: "Scope of the thought: private (default) or shared",
          default: "private",
        },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "delete_thought",
    description:
      "Delete a thought by ID. The thought ID is returned by browse_recent and search_thoughts when using _format: 'json'.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The vector key (ID) of the thought to delete",
        },
        scope: {
          type: "string",
          description: "Scope of the thought: private (default) or shared",
          default: "private",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_agent",
    description:
      "Create an API key for an AI agent. Returns the key and MCP config snippets for Claude Code, Claude Desktop, etc.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Agent name (alphanumeric, hyphens, underscores). e.g. 'claude-code', 'chatgpt'",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_agents",
    description: "List all your registered AI agents and their creation dates.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "revoke_agent",
    description:
      "Revoke an agent's API key. The key will immediately stop working.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The agent name to revoke",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "bus_activity",
    description:
      "Monitor the public feed — recent shared thoughts grouped by contributor, activity counts, and timeline.",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "Look back this many hours (default 24)",
          default: 24,
        },
        agent: {
          type: "string",
          description: "Filter to a specific agent name",
        },
        limit: {
          type: "number",
          description: "Max thoughts to return (default 50)",
          default: 50,
        },
      },
    },
  },
];

// --- JSON-RPC helpers ---

function jsonrpcResponse(
  id: string | number | null,
  result: unknown
): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, result }),
  };
}

function jsonrpcError(
  id: string | number | null,
  code: number,
  message: string,
  statusCode = 200
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    }),
  };
}

// --- Lambda handler ---

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;

  // Health check (GET, no auth required)
  if (method === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ok", name: "open-brain-mcp" }),
    };
  }

  if (method !== "POST") {
    return jsonrpcError(null, -32600, "Method not allowed", 405);
  }

  // Extract user from custom authorizer context
  let user: UserContext;
  try {
    user = extractUserContext(event);
  } catch {
    return jsonrpcError(null, -32600, "Unauthorized", 401);
  }

  const body: McpRequest = JSON.parse(event.body || "{}");
  const { method: rpcMethod, id, params } = body;

  // MCP: initialize
  if (rpcMethod === "initialize") {
    return jsonrpcResponse(id ?? null, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "open-brain", version: "2.0.0" },
    });
  }

  // MCP: initialized notification
  if (rpcMethod === "notifications/initialized") {
    return { statusCode: 204, body: "" };
  }

  // MCP: list tools
  if (rpcMethod === "tools/list") {
    return jsonrpcResponse(id ?? null, { tools: TOOLS });
  }

  // MCP: call tool
  if (rpcMethod === "tools/call") {
    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    let resultText: string;
    try {
      switch (toolName) {
        case "search_thoughts":
          resultText = await handleSearchThoughts(args as any, user);
          break;
        case "browse_recent":
          resultText = await handleBrowseRecent(args as any, user);
          break;
        case "stats":
          resultText = await handleStats(args as any, user);
          break;
        case "capture_thought":
          resultText = await handleCaptureThought(args as any, user);
          break;
        case "update_thought":
          resultText = await handleUpdateThought(args as any, user);
          break;
        case "delete_thought":
          resultText = await handleDeleteThought(args as any, user);
          break;
        case "create_agent":
          resultText = await handleCreateAgent(args as any, user);
          break;
        case "list_agents":
          resultText = await handleListAgents(args as any, user);
          break;
        case "revoke_agent":
          resultText = await handleRevokeAgent(args as any, user);
          break;
        case "bus_activity":
          resultText = await handleBusActivity(args as any, user);
          break;
        default:
          return jsonrpcError(id ?? null, -32601, `Unknown tool: ${toolName}`);
      }
    } catch (e) {
      resultText = `Error: ${(e as Error).message}`;
    }

    return jsonrpcResponse(id ?? null, {
      content: [{ type: "text", text: resultText }],
    });
  }

  // MCP: ping
  if (rpcMethod === "ping") {
    return jsonrpcResponse(id ?? null, {});
  }

  return jsonrpcError(id ?? null, -32601, `Method not found: ${rpcMethod}`);
}
