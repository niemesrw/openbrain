import { generateEmbedding } from "../services/embeddings";
import { extractMetadata } from "../services/metadata";
import { getVector, putVector } from "../services/vectors";
import { validateThoughtText } from "./validate-thought-text";
import type { UpdateThoughtArgs, UserContext } from "../types";

export async function handleUpdateThought(
  args: UpdateThoughtArgs,
  user: UserContext
): Promise<string> {
  const { id, text, scope = "private", media_url } = args;

  const validationError = validateThoughtText(text);
  if (validationError) return validationError;

  const indexName =
    scope === "shared" ? "shared" : `private-${user.userId}`;

  // Fetch existing vector to verify ownership
  const existing = await getVector(indexName, id);
  if (!existing) {
    return `Error: thought not found (id: ${id})`;
  }
  if (existing.metadata.user_id !== user.userId) {
    return "Error: you do not have permission to edit this thought";
  }

  // Re-embed and re-extract metadata in parallel
  const [embedding, metadata] = await Promise.all([
    generateEmbedding(text),
    extractMetadata(text),
  ]);

  // Overwrite the vector with the same key, preserving created_at
  await putVector(indexName, id, embedding, {
    type: metadata.type,
    ...(metadata.topics.length > 0 && { topics: metadata.topics }),
    ...(metadata.people.length > 0 && { people: metadata.people }),
    user_id: user.userId,
    created_at: existing.metadata.created_at ?? Date.now(),
    content: text,
    action_items: JSON.stringify(metadata.action_items),
    dates_mentioned: JSON.stringify(metadata.dates_mentioned),
    ...((media_url ?? existing.metadata.media_url) && { media_url: media_url ?? existing.metadata.media_url }),
    ...(scope === "shared" && {
      display_name: user.displayName || "anonymous",
      ...(user.agentName && { agent_id: user.agentName }),
      tenant_id: user.userId,
    }),
  });

  let confirmation = `Updated as ${metadata.type}`;
  if (metadata.topics.length > 0)
    confirmation += ` — ${metadata.topics.join(", ")}`;
  if (metadata.people.length > 0)
    confirmation += `\nPeople: ${metadata.people.join(", ")}`;

  return confirmation;
}
