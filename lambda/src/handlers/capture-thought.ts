import { randomUUID } from "crypto";
import { generateEmbedding } from "../services/embeddings";
import { extractMetadata } from "../services/metadata";
import { ensurePrivateIndex, putVector } from "../services/vectors";
import { fetchOgImage } from "../services/og-image";
import { validateThoughtText } from "./validate-thought-text";
import type { CaptureArgs, UserContext } from "../types";

export async function handleCaptureThought(
  args: CaptureArgs,
  user: UserContext
): Promise<string> {
  const { text, scope = "private", media_url, source_url } = args;

  const validationError = validateThoughtText(text);
  if (validationError) return validationError;

  // Determine target index
  let indexName: string;
  if (scope === "shared") {
    indexName = "shared";
  } else {
    indexName = await ensurePrivateIndex(user.userId);
  }

  // If source_url is provided and no explicit media_url, try to fetch og:image
  const resolvedMediaUrl =
    media_url ?? (source_url ? await fetchOgImage(source_url) : undefined);

  // Generate embedding and extract metadata in parallel
  const [embedding, metadata] = await Promise.all([
    generateEmbedding(text),
    extractMetadata(text),
  ]);

  const key = randomUUID();

  // S3 Vectors rejects empty arrays in metadata — omit array fields when empty
  await putVector(indexName, key, embedding, {
    type: metadata.type,
    ...(metadata.topics.length > 0 && { topics: metadata.topics }),
    ...(metadata.people.length > 0 && { people: metadata.people }),
    user_id: user.userId,
    created_at: Date.now(),
    content: text,
    action_items: JSON.stringify(metadata.action_items),
    dates_mentioned: JSON.stringify(metadata.dates_mentioned),
    ...(resolvedMediaUrl && { media_url: resolvedMediaUrl }),
    ...(source_url && { source_url }),
    // Attribution for shared captures
    ...(scope === "shared" && {
      display_name: user.displayName || "anonymous",
      ...(user.agentName && { agent_id: user.agentName }),
      tenant_id: user.userId,
    }),
  });

  let confirmation = `Captured as ${metadata.type}`;
  if (metadata.topics.length > 0)
    confirmation += ` — ${metadata.topics.join(", ")}`;
  if (metadata.people.length > 0)
    confirmation += `\nPeople: ${metadata.people.join(", ")}`;
  if (metadata.action_items.length > 0)
    confirmation += `\nAction items: ${metadata.action_items.join("; ")}`;

  return confirmation;
}
