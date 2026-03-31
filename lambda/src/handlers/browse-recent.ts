import { resolveIndexes, listAllVectors } from "../services/vectors";
import type { BrowseArgs, UserContext } from "../types";
import { xmlEscape } from "../utils/xml-escape";

function safeParseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return [];
}

export async function handleBrowseRecent(
  args: BrowseArgs,
  user: UserContext
): Promise<string> {
  const { limit = 10, type, topic, scope = "private", tenant_id, _format } = args;

  const indexes = resolveIndexes(user.userId, scope);

  // List from all target indexes in parallel, tagging with index name
  const indexResults = await Promise.all(
    indexes.map(async (idx) => {
      const vectors = await listAllVectors(idx);
      return vectors.map((v) => ({ ...v, _indexName: idx }));
    })
  );
  let all = indexResults.flat();

  // Apply client-side filters
  if (type) {
    all = all.filter((v) => v.metadata.type === type);
  }
  if (topic) {
    all = all.filter((v) => {
      const topics = v.metadata.topics;
      return Array.isArray(topics) && topics.includes(topic);
    });
  }
  // tenant_id filter applies to shared results — backward-compatible: thoughts without
  // tenant_id (captured before this feature) are always included when filtering
  if (tenant_id) {
    all = all.filter(
      (v) =>
        v._indexName === `private-${user.userId}` ||
        !v.metadata.tenant_id ||
        v.metadata.tenant_id === tenant_id
    );
  }

  // Sort by created_at descending, take limit
  all.sort((a, b) => (b.metadata.created_at ?? 0) - (a.metadata.created_at ?? 0));
  const recent = all.slice(0, limit);

  if (!recent.length)
    return _format === "json"
      ? JSON.stringify({ thoughts: [] })
      : "No thoughts found.";

  if (_format === "json") {
    return JSON.stringify({
      thoughts: recent.map((v) => {
        const m = v.metadata;
        const indexScope = v._indexName.startsWith("private-") ? "private" : "shared";
        return {
          id: v.key,
          content: m.content || "",
          type: m.type || "unknown",
          topics: Array.isArray(m.topics) ? m.topics : [],
          people: Array.isArray(m.people) ? m.people : [],
          action_items: safeParseArray(m.action_items),
          dates_mentioned: safeParseArray(m.dates_mentioned),
          created_at: m.created_at || null,
          scope: indexScope,
          ...(m.media_url && { media_url: m.media_url }),
        };
      }),
    });
  }

  return (
    `${recent.length} recent thought(s):\n\n` +
    recent
      .map((v) => {
        const m = v.metadata;
        const date = m.created_at
          ? new Date(m.created_at).toLocaleDateString()
          : "unknown";
        const topics = Array.isArray(m.topics)
          ? m.topics.join(", ")
          : "none";
        const sourceLabel = m.source ? ` [source: ${m.source}]` : "";
        return `[${date}] ${m.type || "unknown"}${sourceLabel}\n<thought-content>\n${xmlEscape(m.content || "")}\n</thought-content>\nTopics: ${topics}`;
      })
      .join("\n\n---\n\n")
  );
}
