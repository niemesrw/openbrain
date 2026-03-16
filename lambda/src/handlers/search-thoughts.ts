import { generateEmbedding } from "../services/embeddings";
import {
  resolveIndexes,
  queryVectors,
  buildMetadataFilter,
} from "../services/vectors";
import type { SearchArgs, UserContext } from "../types";

function safeParseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  return [];
}

export async function handleSearchThoughts(
  args: SearchArgs,
  user: UserContext
): Promise<string> {
  const {
    query,
    threshold = 0.5,
    limit = 10,
    type,
    topic,
    scope = "private",
    _format,
  } = args;

  const embedding = await generateEmbedding(query);
  const indexes = resolveIndexes(user.userId, scope);
  const filter = buildMetadataFilter({ type, topic });

  // Query all target indexes in parallel, tagging results with index name
  const indexResults = await Promise.all(
    indexes.map(async (idx) => {
      const vectors = await queryVectors(idx, embedding, limit, filter);
      return vectors.map((v) => ({ ...v, _indexName: idx }));
    })
  );

  // Merge and sort by distance (ascending = most similar first)
  const merged = indexResults
    .flat()
    .filter((v) => {
      // S3 Vectors cosine distance: 0 = identical, 2 = opposite
      // Convert to similarity: 1 - (distance / 2)
      const similarity = 1 - (v.distance ?? 2) / 2;
      return similarity >= threshold;
    })
    .sort((a, b) => (a.distance ?? 2) - (b.distance ?? 2))
    .slice(0, limit);

  if (!merged.length)
    return _format === "json"
      ? JSON.stringify({ thoughts: [] })
      : "No matching thoughts found. Try lowering the threshold.";

  if (_format === "json") {
    return JSON.stringify({
      thoughts: merged.map((v) => {
        const m = (v.metadata ?? {}) as Record<string, any>;
        const similarity = Math.round((1 - (v.distance ?? 2) / 2) * 100);
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
          similarity,
          scope: indexScope,
        };
      }),
    });
  }

  return (
    `Found ${merged.length} thought(s):\n\n` +
    merged
      .map((v) => {
        const m = (v.metadata ?? {}) as Record<string, any>;
        const similarity = ((1 - (v.distance ?? 2) / 2) * 100).toFixed(0);
        const date = m.created_at
          ? new Date(m.created_at).toLocaleDateString()
          : "unknown";
        const topics = Array.isArray(m.topics)
          ? m.topics.join(", ")
          : "none";
        return `[${date}] (${similarity}% match)\n${m.content || ""}\nType: ${m.type || "unknown"} | Topics: ${topics}`;
      })
      .join("\n\n---\n\n")
  );
}
