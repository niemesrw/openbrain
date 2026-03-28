import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { extractUserContext } from "./auth/context";
import { executeTool } from "./tool-executor";
import type { UserContext } from "./types";

const CHAT_MODEL_ID =
  process.env.CHAT_MODEL_ID || "claude-haiku-4-5-20251001";
const MAX_STEPS = 10;

const SYSTEM_PROMPT = `You are Open Brain, a personal knowledge assistant. You help users capture thoughts, search their memory, browse recent entries, and understand their brain's contents.

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

If the schedule or action is unclear, ask the user to clarify before scheduling.`;

function buildTools(user: UserContext) {
  return {
    search_thoughts: tool({
      description:
        "Search the brain by meaning (semantic search). Use when the user asks about past decisions, people, projects, or context.",
      inputSchema: z.object({
        query: z.string().describe("What to search for"),
        limit: z.number().optional().describe("Max results (default 10)"),
        type: z
          .string()
          .optional()
          .describe(
            "Filter by type: observation, task, idea, reference, person_note",
          ),
        topic: z.string().optional().describe("Filter by topic"),
      }),
      execute: async (args) => executeTool("search_thoughts", args, user),
    }),
    browse_recent: tool({
      description:
        "Browse recent thoughts chronologically. Use when the user asks what they've been thinking about lately.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Number of recent thoughts (default 10)"),
        type: z.string().optional().describe("Filter by type"),
        topic: z.string().optional().describe("Filter by topic"),
        tenant_id: z
          .string()
          .optional()
          .describe("Filter shared thoughts by tenant (userId)"),
      }),
      execute: async (args) => executeTool("browse_recent", args, user),
    }),
    stats: tool({
      description:
        "Get an overview of the brain — total thoughts, breakdown by type, top topics, people mentioned.",
      inputSchema: z.object({}),
      execute: async () => executeTool("stats", {}, user),
    }),
    capture_thought: tool({
      description:
        "Save a new thought to the brain. Use when the user shares something worth remembering — a decision, observation, idea, or note about a person.",
      inputSchema: z.object({
        text: z.string().describe("The thought to capture"),
        scope: z
          .enum(["private", "shared"])
          .optional()
          .describe("private (default) or shared"),
      }),
      execute: async (args) => executeTool("capture_thought", args, user),
    }),
    schedule_task: tool({
      description:
        "Schedule a recurring background task. Use when the user wants something done automatically on a regular basis.",
      inputSchema: z.object({
        title: z.string().describe("Short task title"),
        schedule: z
          .string()
          .describe("Frequency: hourly, daily, weekly, every N hours"),
        action: z
          .string()
          .describe("What to do — be specific and actionable"),
      }),
      execute: async (args) => executeTool("schedule_task", args, user),
    }),
    list_tasks: tool({
      description: "List the user's active scheduled tasks.",
      inputSchema: z.object({}),
      execute: async () => executeTool("list_tasks", {}, user),
    }),
    cancel_task: tool({
      description: "Cancel a scheduled task by ID.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID to cancel"),
      }),
      execute: async (args) => executeTool("cancel_task", args, user),
    }),
  };
}

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
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
    const anthropic = createAnthropic();
    const result = streamText({
      model: anthropic(CHAT_MODEL_ID),
      system: SYSTEM_PROMPT,
      messages: clientMessages,
      tools: buildTools(user),
      stopWhen: stepCountIs(MAX_STEPS),
    });

    const reply = await result.text;
    return json(200, { reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Chat error:", message);
    return json(500, { error: message });
  }
}
