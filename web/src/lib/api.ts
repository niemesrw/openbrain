import { getIdToken, getApiUrl } from "./auth";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  reply: string;
}

export async function chatWithBrain(
  messages: ChatMessage[],
): Promise<ChatResponse> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();

  const res = await fetch(`${apiUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Chat API error: ${res.status}`);
  }
  return res.json();
}

export interface InsightData {
  headline: string;
  body: string;
  topic: string;
  count: number;
  since: number;
}

export async function getInsight(): Promise<InsightData | null> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();

  const res = await fetch(`${apiUrl}/insight`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.insight ?? null;
}

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
  const token = await getIdToken();
  const apiUrl = getApiUrl();

  const res = await fetch(`${apiUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
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

export interface GitHubInstallation {
  installationId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  installedAt: string;
}

export async function connectGitHubInstallation(
  installationId: string
): Promise<{ ok: boolean; accountLogin: string; accountType: string }> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/github/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ installationId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `GitHub connect error: ${res.status}`);
  }
  return res.json();
}

export async function getGitHubInstallations(): Promise<GitHubInstallation[]> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/github/installations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GitHub installations error: ${res.status}`);
  const data = await res.json();
  return data.installations ?? [];
}

export async function disconnectGitHubInstallation(installationId: string): Promise<void> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/github/installations/${installationId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `GitHub disconnect error: ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // ignore, use status-based message
    }
    throw new Error(message);
  }
}
