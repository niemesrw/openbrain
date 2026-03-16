import { getAccessToken, getApiUrl } from "./auth";

interface McpResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content?: Array<{ type: string; text: string }>;
    [key: string]: unknown;
  };
  error?: { code: number; message: string };
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  const token = await getAccessToken();
  const apiUrl = getApiUrl();

  const res = await fetch(`${apiUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const json = (await res.json()) as McpResponse;
  if (json.error) throw new Error(json.error.message);

  const content = json.result?.content;
  if (content && content.length > 0) {
    return content.map((c) => c.text).join("\n");
  }

  return JSON.stringify(json.result, null, 2);
}
