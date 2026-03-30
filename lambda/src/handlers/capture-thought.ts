import { randomUUID } from "crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { generateEmbedding } from "../services/embeddings";
import { extractMetadata } from "../services/metadata";
import { ensurePrivateIndex, putVector } from "../services/vectors";
import { fetchOgImage } from "../services/og-image";
import { describeImage } from "../services/vision";
import { validateThoughtText } from "./validate-thought-text";
import type { CaptureArgs, UserContext } from "../types";

let sqsClient: SQSClient | undefined;
function getSqsClient(): SQSClient {
  if (!sqsClient) sqsClient = new SQSClient({});
  return sqsClient;
}

export async function handleCaptureThought(
  args: CaptureArgs,
  user: UserContext
): Promise<string> {
  const { text, scope = "private", media_url, source_url, type: typeOverride } = args;

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

  // If there's an image but the text is sparse (short or just a URL), use vision to
  // generate a richer description so the capture is semantically searchable
  const isUrlOnly = /^https?:\/\/\S+$/.test(text.trim());
  let content = text;
  if (resolvedMediaUrl && (text.length < 50 || isUrlOnly)) {
    const description = await describeImage(resolvedMediaUrl);
    if (description) {
      content = `${text}\n\n${description}`;
    }
  }

  // Generate embedding and extract metadata in parallel
  const [embedding, metadata] = await Promise.all([
    generateEmbedding(content),
    extractMetadata(content),
  ]);

  if (typeOverride) {
    metadata.type = typeOverride;
  }

  const key = randomUUID();

  // S3 Vectors rejects empty arrays in metadata — omit array fields when empty
  await putVector(indexName, key, embedding, {
    type: metadata.type,
    ...(metadata.topics.length > 0 && { topics: metadata.topics }),
    ...(metadata.people.length > 0 && { people: metadata.people }),
    user_id: user.userId,
    created_at: Date.now(),
    content: content,
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

  // Enqueue Slack notification for channel: tagged thoughts
  const slackNotifyQueueUrl = process.env.SLACK_NOTIFY_QUEUE_URL;
  const notifyTopics = metadata.topics.filter(
    t => t === "channel:notify" || t === "channel:alert" || t === "channel:shared"
  );
  if (notifyTopics.length > 0 && slackNotifyQueueUrl) {
    void getSqsClient()
      .send(
        new SendMessageCommand({
          QueueUrl: slackNotifyQueueUrl,
          MessageBody: JSON.stringify({
            userId: user.userId,
            thoughtId: key,
            text: content,
            topics: metadata.topics,
          }),
        })
      )
      .catch((err: unknown) => {
        console.error(
          "[capture-thought] Failed to enqueue Slack notification:",
          err instanceof Error ? err.message : String(err)
        );
      });
  }

  let confirmation = `Captured as ${metadata.type}`;
  if (metadata.topics.length > 0)
    confirmation += ` — ${metadata.topics.join(", ")}`;
  if (metadata.people.length > 0)
    confirmation += `\nPeople: ${metadata.people.join(", ")}`;
  if (metadata.action_items.length > 0)
    confirmation += `\nAction items: ${metadata.action_items.join("; ")}`;

  return confirmation;
}
