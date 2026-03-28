import { getIdToken, getApiUrl } from "./auth";

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

export interface SlackInstallation {
  teamId: string;
  teamName: string;
  slackUserId: string;
  installedAt: string;
}

export async function getSlackInstallUrl(): Promise<string> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/slack/install`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack install error: ${res.status}`);
  const data = await res.json() as { url: string };
  return data.url;
}

export async function connectSlackCallback(
  code: string,
  state: string
): Promise<{ ok: boolean; teamName: string; dmSent: boolean }> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/slack/callback`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Slack callback error: ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; teamName: string; dmSent: boolean }>;
}

export async function getSlackInstallations(): Promise<SlackInstallation[]> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/slack/installations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack installations error: ${res.status}`);
  const data = await res.json() as { installations: SlackInstallation[] };
  return data.installations ?? [];
}

export async function disconnectSlackInstallation(teamId: string): Promise<void> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/slack/installations/${encodeURIComponent(teamId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `Slack disconnect error: ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}
