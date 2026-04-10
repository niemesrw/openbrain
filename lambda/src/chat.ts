import type {
  APIGatewayProxyEventV2,
  Context,
} from "aws-lambda";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { streamText, tool, type CoreMessage } from "ai";
import { z } from "zod";
import { verifyAuth } from "./auth/verify";
import { executeTool } from "./tool-executor";
import type { UserContext } from "./types";

// awslambda is a global in the Lambda Node.js runtime — not an npm package.
declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: APIGatewayProxyEventV2,
      responseStream: NodeJS.WritableStream,
      context: Context,
    ) => Promise<void>,
  ) => unknown;
  HttpResponseStream: {
    from: (
      responseStream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers?: Record<string, string> },
    ) => NodeJS.WritableStream & { end: () => void };
  };
};

const CHAT_MODEL_ID =
  process.env.CHAT_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const MAX_STEPS = 10;

// Module-level singleton — Lambda keeps the module warm across invocations.
const bedrock = createAmazonBedrock();

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
- IMPORTANT: When the user asks you to perform an action (add a label, post a comment, close an issue, capture a thought), call the tool immediately. Do not describe what you would do — just do it. Never say "Let me do X" without actually calling the tool in the same response.

Workflows:
When a user describes an automation rule — like "when a PR is merged, summarize it and capture a thought" or "when an issue is labeled urgent, post a comment" — capture it as a workflow thought (type: "workflow"). Workflow thoughts define trigger-action pairs that background agents will execute. Use capture_thought with type override "workflow" so it's correctly classified.

GitHub tools:
You have tools to interact with GitHub on the user's behalf — labeling issues, posting comments, and closing issues. These work through the user's connected GitHub App installation. If the user hasn't connected GitHub, the tools will tell you.

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
      parameters: z.object({
        query: z.string().describe("What to search for"),
        limit: z.number().optional().describe("Max results (default 10)"),
        type: z
          .enum(["observation", "task", "idea", "reference", "person_note", "workflow"])
          .optional()
          .describe("Filter by thought type"),
        topic: z.string().optional().describe("Filter by topic"),
      }),
      execute: async (args) => executeTool("search_thoughts", args, user),
    }),
    browse_recent: tool({
      description:
        "Browse recent thoughts chronologically. Use when the user asks what they've been thinking about lately.",
      parameters: z.object({
        limit: z
          .number()
          .optional()
          .describe("Number of recent thoughts (default 10)"),
        type: z
          .enum(["observation", "task", "idea", "reference", "person_note", "workflow"])
          .optional()
          .describe("Filter by thought type"),
        topic: z.string().optional().describe("Filter by topic"),
        tenant_id: z
          .string()
          .optional()
          .describe("Filter shared thoughts by tenant (userId)"),
        human_only: z
          .boolean()
          .optional()
          .describe("When true, exclude thoughts captured by system agents (github, slack, etc.)"),
      }),
      execute: async (args) => executeTool("browse_recent", args, user),
    }),
    stats: tool({
      description:
        "Get an overview of the brain — total thoughts, breakdown by type, top topics, people mentioned.",
      parameters: z.object({}),
      execute: async () => executeTool("stats", {}, user),
    }),
    capture_thought: tool({
      description:
        "Save a new thought to the brain. Use when the user shares something worth remembering — a decision, observation, idea, or note about a person.",
      parameters: z.object({
        text: z.string().describe("The thought to capture"),
        scope: z
          .enum(["private", "shared"])
          .optional()
          .describe("private (default) or shared"),
        type: z
          .enum(["observation", "task", "idea", "reference", "person_note", "workflow"])
          .optional()
          .describe("Explicit type override — use 'workflow' for automation rules"),
      }),
      execute: async (args) => executeTool("capture_thought", args, user),
    }),
    schedule_task: tool({
      description:
        "Schedule a recurring background task. Use when the user wants something done automatically on a regular basis.",
      parameters: z.object({
        title: z.string().describe("Short task title"),
        schedule: z
          .string()
          .describe("Frequency: hourly, daily, weekly, every N hours"),
        action: z.string().describe("What to do — be specific and actionable"),
      }),
      execute: async (args) => executeTool("schedule_task", args, user),
    }),
    list_tasks: tool({
      description: "List the user's active scheduled tasks.",
      parameters: z.object({}),
      execute: async () => executeTool("list_tasks", {}, user),
    }),
    cancel_task: tool({
      description: "Cancel a scheduled task by ID.",
      parameters: z.object({
        taskId: z.string().describe("Task ID to cancel"),
      }),
      execute: async (args) => executeTool("cancel_task", args, user),
    }),
    // GitHub tools — human-only to prevent agent prompt injection
    ...(!user.agentName
      ? {
          github_label: tool({
            description:
              "Add, set, or remove labels on a GitHub issue or PR.",
            parameters: z.object({
              owner: z.string().describe("Repository owner (org or user)"),
              repo: z.string().describe("Repository name"),
              issue_number: z.number().int().positive().describe("Issue or PR number"),
              labels: z.array(z.string()).min(1).describe("Label names"),
              action: z
                .enum(["add", "set", "remove"])
                .default("add")
                .describe("add (default), set (replace all), or remove"),
            }),
            execute: async (args) => executeTool("github_label", args, user),
          }),
          github_comment: tool({
            description:
              "Post a comment on a GitHub issue or PR.",
            parameters: z.object({
              owner: z.string().describe("Repository owner (org or user)"),
              repo: z.string().describe("Repository name"),
              issue_number: z.number().int().positive().describe("Issue or PR number"),
              body: z.string().describe("Comment body (markdown supported)"),
            }),
            execute: async (args) => executeTool("github_comment", args, user),
          }),
          github_close: tool({
            description:
              "Close a GitHub issue or PR.",
            parameters: z.object({
              owner: z.string().describe("Repository owner (org or user)"),
              repo: z.string().describe("Repository name"),
              issue_number: z.number().int().positive().describe("Issue or PR number"),
              state_reason: z
                .enum(["completed", "not_planned"])
                .default("completed")
                .describe("Reason for closing (default: completed)"),
            }),
            execute: async (args) => executeTool("github_close", args, user),
          }),
        }
      : {}),
  };
}

export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEventV2,
    responseStream: NodeJS.WritableStream,
    _context: Context,
  ) => {
    const sendError = (statusCode: number, message: string) => {
      console.error(`[chat] sendError ${statusCode}: ${message}`);
      const httpStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode,
        headers: { "Content-Type": "application/json" },
      });
      httpStream.write(JSON.stringify({ error: message }));
      httpStream.end();
    };

    console.log("[chat] request received", { headers: Object.keys(event.headers ?? {}) });

    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
      console.log("[chat] auth ok", { userId: user.userId });
    } catch (e) {
      console.error("[chat] auth failed", e instanceof Error ? e.message : String(e));
      sendError(401, "Unauthorized");
      return;
    }

    let body: { messages?: CoreMessage[] };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      sendError(400, "Invalid JSON body");
      return;
    }

    const messages = body.messages ?? [];
    if (messages.length === 0) {
      sendError(400, "messages array is required");
      return;
    }

    console.log("[chat] invoking bedrock", { model: CHAT_MODEL_ID, messageCount: messages.length });

    const httpStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "x-vercel-ai-data-stream": "v1",
      },
    });

    try {
      const result = streamText({
        model: bedrock(CHAT_MODEL_ID),
        system: SYSTEM_PROMPT,
        messages,
        tools: buildTools(user),
        maxSteps: MAX_STEPS,
      });

      const reader = result.toDataStream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const canContinue = httpStream.write(value);
        if (!canContinue) {
          await new Promise<void>((resolve, reject) => {
            httpStream.once("drain", resolve);
            httpStream.once("error", reject);
          });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Chat error:", message);
      // Headers already sent — write error as a stream data event
      httpStream.write(
        new TextEncoder().encode(`3:${JSON.stringify(message)}\n`),
      );
    } finally {
      httpStream.end();
    }
  },
);
