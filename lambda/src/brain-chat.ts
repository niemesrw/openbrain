import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { verifyAuth } from "./auth/verify";
import { executeTool } from "./tool-executor";

const client = new BedrockRuntimeClient({});
const MODEL_ID =
  process.env.CHAT_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const MAX_TOOL_ROUNDS = 3;
const MAX_MESSAGE_CHARS = 10_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_MSG_CHARS = 10_000;

const SYSTEM_PROMPT = `You are the user's brain — their personal semantic memory. You hold their captured thoughts, observations, ideas, tasks, and notes. When they talk to you, you ARE their memory speaking back.

- Speak as their memory: "I remember...", "You captured this on...", "I have X thoughts about..."
- Be warm but concise — a trusted inner voice, not a chatbot
- Weave memories into natural responses, don't dump search results as lists
- If you find nothing, be honest: "I don't have any memories about that yet"
- For capture requests, confirm naturally: "Got it, I'll remember that"
- When you see patterns across memories, connect the dots proactively
- Always pass _format: "json" when calling search_thoughts, browse_recent, stats, or bus_activity so you get structured data you can reason over
- Keep responses conversational and relatively short — a few sentences to a short paragraph unless the user asks for detail`;

const BRAIN_TOOLS = [
  {
    name: "search_thoughts",
    description: "Search the user's brain by meaning (semantic similarity).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 2000 },
        limit: { type: "number" },
        _format: { type: "string", enum: ["json"] },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_recent",
    description: "Browse recent thoughts chronologically.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        type: { type: "string" },
        topic: { type: "string" },
        _format: { type: "string", enum: ["json"] },
      },
    },
  },
  {
    name: "stats",
    description: "Get an overview of the brain — totals, types, top topics.",
    input_schema: {
      type: "object",
      properties: {
        _format: { type: "string", enum: ["json"] },
      },
    },
  },
  {
    name: "capture_thought",
    description: "Save a new thought to the brain.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        scope: { type: "string", enum: ["private", "shared"] },
        type: { type: "string", enum: ["observation", "task", "idea", "reference", "person_note", "workflow"] },
      },
      required: ["text"],
    },
  },
  {
    name: "bus_activity",
    description: "Monitor the shared public feed.",
    input_schema: {
      type: "object",
      properties: {
        hours: { type: "number" },
        limit: { type: "number" },
        _format: { type: "string", enum: ["json"] },
      },
    },
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history?: ChatMessage[];
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  let user;
  try {
    user = await verifyAuth(event.headers ?? {});
  } catch {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  let body: ChatRequest;
  try {
    body = JSON.parse(event.body || "{}");
    if (typeof body.message !== "string" || !body.message) throw new Error("missing message");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: "message is required" }),
    };
  }

  if (body.message.length > MAX_MESSAGE_CHARS) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: `message exceeds maximum length of ${MAX_MESSAGE_CHARS} characters` }),
    };
  }

  const toolsUsed: string[] = [];
  let thoughtsReferenced = 0;

  // Build messages array
  const messages: Array<{ role: string; content: unknown }> = [];
  if (Array.isArray(body.history)) {
    for (const msg of body.history.slice(-MAX_HISTORY_MESSAGES)) {
      const raw = typeof msg.content === "string" ? msg.content : String(msg.content ?? "");
      const content = raw.length > MAX_HISTORY_MSG_CHARS ? raw.slice(0, MAX_HISTORY_MSG_CHARS) : raw;
      messages.push({ role: msg.role, content });
    }
  }
  messages.push({ role: "user", content: body.message });

  // Tool-use loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: BRAIN_TOOLS,
      }),
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const content = result.content as Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;

    const toolUseBlocks = content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0 || result.stop_reason === "end_turn") {
      const text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", ...cors },
        body: JSON.stringify({ response: text, toolsUsed, thoughtsReferenced }),
      };
    }

    messages.push({ role: "assistant", content });

    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    for (const block of toolUseBlocks) {
      toolsUsed.push(block.name!);
      let toolOutput: string;
      try {
        toolOutput = await executeTool(block.name!, block.input ?? {}, user);
      } catch (e) {
        toolOutput = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }

      try {
        const parsed = JSON.parse(toolOutput);
        if (Array.isArray(parsed.thoughts)) thoughtsReferenced += parsed.thoughts.length;
        if (Array.isArray(parsed.recent)) thoughtsReferenced += parsed.recent.length;
      } catch {
        // not JSON
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id!, content: toolOutput });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", ...cors },
    body: JSON.stringify({
      response: "I searched through your memories but need a more specific question to give you a good answer.",
      toolsUsed,
      thoughtsReferenced,
    }),
  };
}
