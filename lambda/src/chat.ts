import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type SystemContentBlock,
  type Tool,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { extractUserContext } from "./auth/context";
import { executeTool } from "./tool-executor";

const CHAT_MODEL_ID =
  process.env.CHAT_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const MAX_TOOL_ROUNDS = 10;

const bedrock = new BedrockRuntimeClient({});

const SYSTEM_PROMPT: SystemContentBlock[] = [{
    text: `You are Open Brain, a personal knowledge assistant. You help users capture thoughts, search their memory, browse recent entries, and understand their brain's contents.

Behavior:
- When a user shares a thought, observation, idea, or decision, use capture_thought to save it. Confirm naturally.
- When a user asks about something they might have stored, use search_thoughts to find it. Summarize what you find conversationally.
- When a user wants to see recent activity, use browse_recent.
- For overview questions ("how many thoughts", "what topics"), use stats.
- You can chain multiple tool calls if needed.
- Always respond conversationally — don't dump raw data. Summarize and present clearly.
- Default scope is "private" unless the user says to share.
- Be concise. Don't over-explain what you're doing.

Scheduled tasks:
When a user expresses a recurring wish, automated task, or scheduled need — like "tell me the weather every morning", "check my portfolio daily", or "remind me to review PRs every Monday" — use the schedule_task tool to set it up. Background agents will execute it automatically on the specified schedule.

IMPORTANT — duplicate prevention:
- Before creating a new task, always call list_tasks first and read the output carefully.
- Compare existing tasks by their schedule (in parentheses) and "Action:" line.
- Exact duplicates (same schedule AND same action text): do NOT create a new task. If multiple exact duplicates exist, cancel all but one so only a single copy remains, then tell the user.
- Similar but not exact (overlapping schedule or similar action): do NOT auto-cancel. Summarize what you found and ask the user which tasks to keep or cancel before taking action.
- Only auto-cancel when tasks are clearly duplicates. When in doubt, ask.

Use list_tasks to show the user their active tasks. Use cancel_task to remove one.

If the schedule or action is unclear, ask the user to clarify before scheduling.`,
}];

const CHAT_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: "search_thoughts",
      description:
        "Search the brain by meaning (semantic search). Use when the user asks about past decisions, people, projects, or context.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for" },
            limit: { type: "number", description: "Max results (default 10)" },
            type: {
              type: "string",
              description: "Filter by type: observation, task, idea, reference, person_note",
            },
            topic: { type: "string", description: "Filter by topic" },
          },
          required: ["query"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "browse_recent",
      description:
        "Browse recent thoughts chronologically. Use when the user asks what they've been thinking about lately.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number of recent thoughts (default 10)" },
            type: { type: "string", description: "Filter by type" },
            topic: { type: "string", description: "Filter by topic" },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: "stats",
      description:
        "Get an overview of the brain — total thoughts, breakdown by type, top topics, people mentioned.",
      inputSchema: {
        json: { type: "object", properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "capture_thought",
      description:
        "Save a new thought to the brain. Use when the user shares something worth remembering — a decision, observation, idea, or note about a person.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            text: { type: "string", description: "The thought to capture" },
            scope: {
              type: "string",
              enum: ["private", "shared"],
              description: "private (default) or shared",
            },
          },
          required: ["text"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "schedule_task",
      description:
        "Schedule a recurring background task. Use when the user wants something done automatically on a regular basis.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short task title" },
            schedule: {
              type: "string",
              description: "Frequency: hourly, daily, weekly, every N hours",
            },
            action: {
              type: "string",
              description: "What to do — be specific and actionable",
            },
          },
          required: ["title", "schedule", "action"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "list_tasks",
      description: "List the user's active scheduled tasks.",
      inputSchema: {
        json: { type: "object", properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "cancel_task",
      description: "Cancel a scheduled task by ID.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task ID to cancel" },
          },
          required: ["taskId"],
        },
      },
    },
  },
];

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

async function converseLoop(
  clientMessages: ClientMessage[],
  userId: string,
  displayName?: string,
  agentName?: string,
): Promise<string> {
  const user = { userId, displayName, agentName };

  // Convert client messages to Converse format
  const messages: Message[] = clientMessages.map((m) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: CHAT_MODEL_ID,
        system: SYSTEM_PROMPT,
        messages,
        toolConfig: { tools: CHAT_TOOLS },
        inferenceConfig: { maxTokens: 2048 },
      }),
    );

    const stopReason = response.stopReason;
    const outputMessage = response.output?.message;
    if (!outputMessage) throw new Error("No response from model");

    // Add assistant response to conversation
    messages.push(outputMessage);

    if (stopReason === "end_turn") {
      // Extract text from response
      const textBlocks = outputMessage.content?.filter((b) => b.text) ?? [];
      return textBlocks.map((b) => b.text).join("\n");
    }

    if (stopReason === "tool_use") {
      const toolUseBlocks =
        outputMessage.content?.filter((b) => b.toolUse) ?? [];

      const toolResults: ContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const tu = block.toolUse!;
        let resultContent: ToolResultContentBlock[];
        try {
          const result = await executeTool(
            tu.name!,
            (tu.input as Record<string, unknown>) ?? {},
            user,
          );
          resultContent = [{ text: result }];
        } catch (e) {
          resultContent = [
            { text: `Error: ${e instanceof Error ? e.message : String(e)}` },
          ];
        }

        toolResults.push({
          toolResult: {
            toolUseId: tu.toolUseId,
            content: resultContent,
          },
        });
      }

      // Add tool results as user message
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Unexpected stop reason
    throw new Error(`Unexpected stop reason: ${stopReason}`);
  }

  throw new Error("Too many tool rounds");
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const json = (status: number, body: Record<string, unknown>) => ({
    statusCode: status,
    headers: { "Content-Type": "application/json" } as Record<string, string>,
    body: JSON.stringify(body),
  });

  let user;
  try {
    user = extractUserContext(event);
  } catch {
    return json(401, { error: "Unauthorized" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const clientMessages: ClientMessage[] = body.messages ?? [];
  if (clientMessages.length === 0) {
    return json(400, { error: "messages array is required" });
  }

  try {
    const reply = await converseLoop(
      clientMessages,
      user.userId,
      user.displayName,
      user.agentName,
    );
    return json(200, { reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Chat error:", message);
    return json(500, { error: message });
  }
}
