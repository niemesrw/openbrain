import { callTool } from "./api";
import type { Thought, BrainStats, BusActivity, Agent } from "./brain-types";

type Scope = "private" | "shared" | "all";

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
  filters?: { type?: string; topic?: string; scope?: Scope; limit?: number }
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
  filters?: { type?: string; topic?: string; scope?: Scope; limit?: number }
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

export async function captureThought(
  text: string,
  options?: { scope?: "private" | "shared"; type?: string }
): Promise<string> {
  const args: Record<string, unknown> = { text };
  if (options?.scope) args.scope = options.scope;
  if (options?.type) args.type = options.type;
  return callTool("capture_thought", args);
}
