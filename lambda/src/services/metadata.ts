import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { ThoughtMetadata } from "../types";

const client = new BedrockRuntimeClient({});
const MODEL_ID =
  process.env.METADATA_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";

const SYSTEM_PROMPT = `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there. Return ONLY valid JSON, no other text.`;

export async function extractMetadata(
  text: string
): Promise<ThoughtMetadata> {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    }),
  });

  const response = await client.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));

  try {
    const content = result.content[0].text;
    return JSON.parse(content) as ThoughtMetadata;
  } catch {
    return {
      topics: ["uncategorized"],
      type: "observation",
      people: [],
      action_items: [],
      dates_mentioned: [],
    };
  }
}
