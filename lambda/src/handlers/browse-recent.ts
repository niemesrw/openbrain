import { resolveIndexes, listAllVectors } from "../services/vectors";
import type { BrowseArgs, UserContext } from "../types";

export async function handleBrowseRecent(
  args: BrowseArgs,
  user: UserContext
): Promise<string> {
  const { limit = 10, type, topic, scope = "private", _format } = args;

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
          content: m.content || "",
          type: m.type || "unknown",
          topics: Array.isArray(m.topics) ? m.topics : [],
          people: Array.isArray(m.people) ? m.people : [],
          action_items: m.action_items || "",
          dates_mentioned: m.dates_mentioned || "",
          created_at: m.created_at || null,
          scope: indexScope,
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
        return `[${date}] ${m.type || "unknown"}\n${m.content || ""}\nTopics: ${topics}`;
      })
      .join("\n\n---\n\n")
  );
}
