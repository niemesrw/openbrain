import { listAllVectors } from "../services/vectors";
import type { BusActivityArgs, UserContext } from "../types";

export async function handleBusActivity(
  args: BusActivityArgs,
  _user: UserContext
): Promise<string> {
  const hours = args.hours ?? 24;
  const limit = args.limit ?? 50;
  const agentFilter = args.agent;
  const tenantFilter = args.tenant_id;
  const _format = args._format;

  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  // NOTE: Full index scan — fine for early-stage use. At scale (10K+ shared
  // thoughts), replace with a DynamoDB table keyed on created_at for efficient
  // time-range queries without scanning the entire vector index.
  const vectors = await listAllVectors("shared");

  // Filter to recent + optional agent filter
  let recent = vectors
    .filter((v) => (v.metadata.created_at ?? 0) >= cutoff)
    .sort((a, b) => (b.metadata.created_at ?? 0) - (a.metadata.created_at ?? 0));

  if (agentFilter) {
    recent = recent.filter((v) => v.metadata.agent_id === agentFilter);
  }
  if (tenantFilter) {
    recent = recent.filter((v) => v.metadata.tenant_id === tenantFilter);
  }

  recent = recent.slice(0, limit);

  // Group by user/agent
  const byActor = new Map<string, { count: number; latest: number }>();
  for (const v of recent) {
    const m = v.metadata;
    const actor = m.agent_id
      ? `${m.display_name || "unknown"}/${m.agent_id}`
      : m.display_name || m.user_id || "anonymous";
    const existing = byActor.get(actor) || { count: 0, latest: 0 };
    existing.count++;
    existing.latest = Math.max(existing.latest, m.created_at ?? 0);
    byActor.set(actor, existing);
  }

  if (recent.length === 0) {
    if (_format === "json") {
      return JSON.stringify({
        summary: { total: 0, hours },
        by_agent: [],
        recent: [],
      });
    }
    return `No shared activity in the last ${hours} hour(s).`;
  }

  if (_format === "json") {
    return JSON.stringify({
      summary: { total: recent.length, hours },
      by_agent: Array.from(byActor.entries()).map(([actor, stats]) => ({
        agent: actor,
        count: stats.count,
        last_active: new Date(stats.latest).toISOString(),
      })),
      recent: recent.slice(0, 10).map((v) => {
        const m = v.metadata;
        return {
          content: (m.content || "").slice(0, 200),
          agent: m.agent_id
            ? `${m.display_name || "?"}/${m.agent_id}`
            : m.display_name || "anonymous",
          type: m.type || "unknown",
          topics: Array.isArray(m.topics) ? m.topics : [],
          created_at: m.created_at ? new Date(m.created_at).toISOString() : null,
        };
      }),
    });
  }

  const lines: string[] = [
    `Shared feed activity (last ${hours}h): ${recent.length} thought(s)`,
    "",
    "By contributor:",
  ];

  for (const [actor, stats] of byActor) {
    const ago = Math.round((Date.now() - stats.latest) / 60000);
    lines.push(`  ${actor}: ${stats.count} thought(s), latest ${ago}m ago`);
  }

  lines.push("", "Recent thoughts:");
  for (const v of recent.slice(0, 10)) {
    const m = v.metadata;
    const actor = m.agent_id
      ? `${m.display_name || "?"}/${m.agent_id}`
      : m.display_name || "anonymous";
    const type = m.type || "?";
    const content = (m.content || "").slice(0, 100);
    const ago = Math.round((Date.now() - (m.created_at ?? 0)) / 60000);
    lines.push(`  [${type}] ${actor} (${ago}m ago): ${content}`);
  }

  return lines.join("\n");
}
