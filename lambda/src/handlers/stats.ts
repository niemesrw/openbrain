import { resolveIndexes, listAllVectors } from "../services/vectors";
import type { StatsArgs, UserContext } from "../types";

export async function handleStats(args: StatsArgs, user: UserContext): Promise<string> {
  // Get all thoughts from private + shared indexes
  const indexes = resolveIndexes(user.userId, "all");
  const results = await Promise.all(indexes.map((idx) => listAllVectors(idx)));
  const all = results.flat();

  const total = all.length;
  const types: Record<string, number> = {};
  const topics: Record<string, number> = {};
  const people: Record<string, number> = {};
  let earliest = Infinity;

  for (const v of all) {
    const m = v.metadata;
    if (m.type) types[m.type] = (types[m.type] || 0) + 1;
    if (Array.isArray(m.topics)) {
      for (const t of m.topics) topics[t] = (topics[t] || 0) + 1;
    }
    if (Array.isArray(m.people)) {
      for (const p of m.people) people[p] = (people[p] || 0) + 1;
    }
    if (m.created_at && m.created_at < earliest) earliest = m.created_at;
  }

  if (args._format === "json") {
    return JSON.stringify({
      total,
      earliest: earliest < Infinity ? earliest : null,
      types,
      topics,
      people,
    });
  }

  const sortDesc = (obj: Record<string, number>) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

  const earliestDate =
    earliest < Infinity ? new Date(earliest).toLocaleDateString() : "N/A";

  return [
    `Total thoughts: ${total}`,
    `Since: ${earliestDate}`,
    `\nBy type:\n${sortDesc(types)}`,
    `\nTop topics:\n${sortDesc(topics)}`,
    Object.keys(people).length
      ? `\nPeople mentioned:\n${sortDesc(people)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
