import { getConfig } from "./config.js";
import { getToken, getTokenB } from "./auth.js";

let _rpcId = 1;

export interface McpResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string };
}

/** Makes an authenticated MCP JSON-RPC call. */
export async function mcp<T = unknown>(
  method: string,
  params?: Record<string, unknown>
): Promise<McpResponse<T>> {
  const config = await getConfig();
  const token = await getToken();
  const id = _rpcId++;

  const res = await fetch(`${config.apiUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  return res.json() as Promise<McpResponse<T>>;
}

/** Makes an authenticated MCP JSON-RPC call as user B. */
export async function mcpB<T = unknown>(
  method: string,
  params?: Record<string, unknown>
): Promise<McpResponse<T>> {
  const config = await getConfig();
  const token = await getTokenB();
  const id = _rpcId++;

  const res = await fetch(`${config.apiUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  return res.json() as Promise<McpResponse<T>>;
}

/** Raw fetch against the MCP endpoint without auth. */
export async function mcpRaw(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Response> {
  const config = await getConfig();
  return fetch(`${config.apiUrl}/mcp`, {
    method: options.method ?? "POST",
    headers: options.headers,
    body: options.body,
  });
}

/** Extracts the text content from a tools/call result. */
export function toolText(
  res: McpResponse<{ content: { type: string; text: string }[] }>
): string {
  return res.result?.content?.[0]?.text ?? "";
}
