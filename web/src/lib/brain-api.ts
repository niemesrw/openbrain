import { callTool } from "./api";
import type { Thought, BrainStats, BusActivity, Agent } from "./brain-types";

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

export async function searchThoughts(
  query: string,
  filters?: { type?: string; topic?: string; scope?: string; limit?: number }
): Promise<Thought[]> {
  const result = await callTool("search_thoughts", {
    query,
    scope: "all",
    limit: 20,
    ...filters,
    _format: "json",
  });
  return parseJson<{ thoughts: Thought[] }>(result).thoughts;
}

export async function browseRecent(
  filters?: { type?: string; topic?: string; scope?: string; limit?: number }
): Promise<Thought[]> {
  const result = await callTool("browse_recent", {
    scope: "all",
    limit: 20,
    ...filters,
    _format: "json",
  });
  return parseJson<{ thoughts: Thought[] }>(result).thoughts;
}

export async function getStats(): Promise<BrainStats> {
  const result = await callTool("stats", { _format: "json" });
  return parseJson<BrainStats>(result);
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
  return parseJson<BusActivity>(result);
}

export async function listAgents(): Promise<Agent[]> {
  const result = await callTool("list_agents", { _format: "json" });
  return parseJson<{ agents: Agent[] }>(result).agents;
}

export async function createAgent(name: string): Promise<string> {
  return callTool("create_agent", { name });
}

export async function revokeAgent(name: string): Promise<string> {
  return callTool("revoke_agent", { name });
}
