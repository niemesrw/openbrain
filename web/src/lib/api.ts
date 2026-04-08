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

export interface GoogleConnection {
  email: string;
  connectedAt: string;
}

export async function getGoogleConnectUrl(): Promise<string> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/google/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google connect error: ${res.status}`);
  const data = await res.json() as { url: string };
  return data.url;
}

export async function connectGoogleCallback(
  code: string,
  state: string
): Promise<{ ok: boolean; email: string }> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/google/callback`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Google callback error: ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; email: string }>;
}

export async function getGoogleConnections(): Promise<GoogleConnection[]> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/google/connections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google connections error: ${res.status}`);
  const data = await res.json() as { connections?: Array<{ email: string; connectedAt: string } & Record<string, unknown>> };
  return (data.connections ?? []).map(({ email, connectedAt }) => ({ email, connectedAt }));
}

export async function disconnectGoogleConnection(email: string): Promise<void> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/google/connections`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    let message = `Google disconnect error: ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}

export async function syncGmail(
  email: string
): Promise<{ captured: number; skipped: number }> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/google/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Gmail sync error: ${res.status}`);
  }
  return res.json() as Promise<{ captured: number; skipped: number }>;
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

export async function deleteAccount(): Promise<void> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/user`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Delete account error: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface AgentTask {
  taskId: string;
  title: string;
  schedule: string;
  action: string;
  status: string;
  lastRunAt: number | null;
  createdAt: number;
}

export async function listTasks(signal?: AbortSignal): Promise<AgentTask[]> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/tasks`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to list tasks: ${res.status}`);
  const data = await res.json() as { tasks: AgentTask[] };
  return data.tasks;
}

export async function createTask(
  title: string,
  schedule: string,
  action: string,
  signal?: AbortSignal
): Promise<string> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, schedule, action }),
    signal,
  });
  const body = await res.json() as { ok?: boolean; message?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Create task error: ${res.status}`);
  return body.message ?? "Task scheduled.";
}

export async function cancelTask(taskId: string, signal?: AbortSignal): Promise<string> {
  const token = await getIdToken();
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const body = await res.json() as { ok?: boolean; message?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Cancel task error: ${res.status}`);
  return body.message ?? "Task cancelled.";
}
