import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { listAllVectors } from "../services/vectors";
import type { UserContext } from "../types";

const METADATA_MODEL_ID =
  process.env.METADATA_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const bedrock = new BedrockRuntimeClient({});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_THOUGHTS = 2; // minimum thoughts on a topic to generate an insight
const MAX_THOUGHT_SNIPPETS = 6; // how many thought contents to send to Bedrock

export interface InsightResponse {
  headline: string;
  body: string;
  topic: string;
  count: number;
  since: number; // epoch ms
}

export async function handleInsight(
  user: UserContext
): Promise<InsightResponse | null> {
  const since = Date.now() - SEVEN_DAYS_MS;

  const vectors = await listAllVectors(`private-${user.userId}`);

  const recent = vectors.filter(
    (v) => (v.metadata.created_at ?? 0) > since
  );

  if (recent.length < MIN_THOUGHTS) return null;

  // Tally thoughts per topic, collecting content snippets
  const topicMap = new Map<string, { count: number; snippets: string[] }>();
  for (const v of recent) {
    const topics = Array.isArray(v.metadata.topics) ? v.metadata.topics : [];
    const content = (v.metadata.content ?? "").slice(0, 300);
    for (const topic of topics) {
      const entry = topicMap.get(topic) ?? { count: 0, snippets: [] };
      entry.count++;
      if (entry.snippets.length < MAX_THOUGHT_SNIPPETS) {
        entry.snippets.push(content);
      }
      topicMap.set(topic, entry);
    }
  }

  // Find the hottest topic meeting the minimum threshold
  const candidates = [...topicMap.entries()]
    .filter(([, v]) => v.count >= MIN_THOUGHTS)
    .sort((a, b) => b[1].count - a[1].count);

  if (candidates.length === 0) return null;

  const [topTopic, { count, snippets }] = candidates[0];

  const numbered = snippets
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  const prompt = `Here are ${snippets.length} snippets from ${count} thoughts captured in the last 7 days, all related to "${topTopic}":

${numbered}

In exactly two sentences, what pattern or insight is emerging from this thinking? Be specific and forward-looking. Speak directly to the person (use "you", not "the user"). Do not restate the topic name in the first word.`;

  const response = await bedrock.send(
    new ConverseCommand({
      modelId: METADATA_MODEL_ID,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 120, temperature: 0.4 },
    })
  );

  const text =
    response.output?.message?.content?.find((b) => b.text)?.text ?? "";

  if (!text) return null;

  // Split into headline (first sentence) and body (rest)
  const firstPeriod = text.search(/[.!?]\s/);
  const headline =
    firstPeriod > 0 ? text.slice(0, firstPeriod + 1).trim() : text.trim();
  const body =
    firstPeriod > 0 ? text.slice(firstPeriod + 1).trim() : "";

  return { headline, body, topic: topTopic, count, since };
}
