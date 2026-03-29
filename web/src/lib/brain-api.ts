import { callTool } from "./api";
import type { Thought, BrainStats, BusActivity, Agent, Scope, ReadScope } from "./brain-types";

function parseJson<T>(toolName: string, text: string): T {
  if (text.startsWith("Error:")) {
    throw new Error(`${toolName}: ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${toolName}: unexpected response format`);
  }
}

export async function searchThoughts(
  query: string,
  filters?: { type?: string; topic?: string; scope?: ReadScope; limit?: number }
): Promise<Thought[]> {
  const result = await callTool("search_thoughts", {
    query,
    scope: "all",
    limit: 20,
    ...filters,
    _format: "json",
  });
  return parseJson<{ thoughts: Thought[] }>("search_thoughts", result).thoughts;
}

export async function browseRecent(
  filters?: { type?: string; topic?: string; scope?: ReadScope; limit?: number }
): Promise<Thought[]> {
  const result = await callTool("browse_recent", {
    scope: "all",
    limit: 20,
    ...filters,
    _format: "json",
  });
  return parseJson<{ thoughts: Thought[] }>("browse_recent", result).thoughts;
}

export async function getStats(): Promise<BrainStats> {
  const result = await callTool("stats", { _format: "json" });
  return parseJson<BrainStats>("stats", result);
}

export async function getBusActivity(params?: {
  hours?: number;
  agent?: string;
  limit?: number;
}): Promise<BusActivity> {
  const result = await callTool("bus_activity", {
    ...params,
    _format: "json",
  });
  return parseJson<BusActivity>("bus_activity", result);
}

export async function listAgents(): Promise<Agent[]> {
  const result = await callTool("list_agents", { _format: "json" });
  return parseJson<{ agents: Agent[] }>("list_agents", result).agents;
}

export async function createAgent(name: string): Promise<string> {
  return callTool("create_agent", { name });
}

export async function revokeAgent(name: string): Promise<string> {
  return callTool("revoke_agent", { name });
}

function extractUrl(text: string): string | undefined {
  try {
    const match = text.match(/https?:\/\/[^\s]+/);
    if (!match) return undefined;
    const urlText = match[0].replace(/[)\]>"'.,;:!?]+$/u, "");
    new URL(urlText);
    return urlText;
  } catch {
    return undefined;
  }
}

export async function captureThought(
  text: string,
  scope: Scope = "private"
): Promise<string> {
  const sourceUrl = extractUrl(text);
  return callTool("capture_thought", {
    text,
    scope,
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
  });
}

export async function updateThought(
  id: string,
  text: string,
  scope: Scope = "private"
): Promise<string> {
  return callTool("update_thought", { id, text, scope });
}

export async function deleteThought(
  id: string,
  scope: Scope = "private"
): Promise<string> {
  return callTool("delete_thought", { id, scope });
}
