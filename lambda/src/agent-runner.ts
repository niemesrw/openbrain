import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type SystemContentBlock,
  type Tool,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { handleSearchThoughts } from "./handlers/search-thoughts";
import { handleCaptureThought } from "./handlers/capture-thought";
import {
  getAllActiveTasks,
  updateTaskLastRun,
  type AgentTask,
} from "./handlers/agent-tasks";
import type { UserContext } from "./types";

const CHAT_MODEL_ID =
  process.env.CHAT_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const MAX_TOOL_ROUNDS = 5;
const MAX_FETCH_CHARS = 10_000;
// Lock TTL slightly longer than Lambda timeout to auto-expire on crash
const LOCK_TTL_SECONDS = 6 * 60;
const LOCK_PK = "LOCK#runner";
const LOCK_SK = "LOCK#runner";

const bedrock = new BedrockRuntimeClient({});
const ddb = new DynamoDBClient({});
const TASKS_TABLE = process.env.AGENT_TASKS_TABLE || "openbrain-agent-tasks";

async function acquireRunLock(): Promise<boolean> {
  const expiresAt = Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS;
  try {
    await ddb.send(new PutItemCommand({
      TableName: TASKS_TABLE,
      Item: {
        userId: { S: LOCK_PK },
        taskId: { S: LOCK_SK },
        expiresAt: { N: String(expiresAt) },
      },
      // Only succeed if no lock exists, or the existing one has expired
      ConditionExpression: "attribute_not_exists(userId) OR expiresAt < :now",
      ExpressionAttributeValues: { ":now": { N: String(Math.floor(Date.now() / 1000)) } },
    }));
    return true;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

async function releaseRunLock(): Promise<void> {
  await ddb.send(new DeleteItemCommand({
    TableName: TASKS_TABLE,
    Key: { userId: { S: LOCK_PK }, taskId: { S: LOCK_SK } },
  }));
}

// Block SSRF to internal/metadata IPs
const BLOCKED_IP_PATTERNS = [
  /^https?:\/\/169\.254\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/127\./,
  /^https?:\/\/localhost/i,
  /^https?:\/\/\[::1\]/,
];

function isBlockedUrl(url: string): boolean {
  return BLOCKED_IP_PATTERNS.some((p) => p.test(url));
}

export function scheduleToMs(schedule: string): number {
  const lower = schedule.toLowerCase();
  if (lower.includes("hourly") || lower === "every hour") return 3_600_000;
  if (lower.includes("weekly")) return 604_800_000;
  const everyNMinutes = lower.match(/every\s+(\d+)\s*min(?:ute)?s?\b/);
  if (everyNMinutes) {
    const minutes = parseInt(everyNMinutes[1], 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return 86_400_000;
    return minutes * 60_000;
  }
  const everyNHours = lower.match(/every\s+(\d+)\s*hours?/);
  if (everyNHours) {
    const hours = parseInt(everyNHours[1], 10);
    if (!Number.isFinite(hours) || hours <= 0) return 86_400_000;
    return hours * 3_600_000;
  }
  return 86_400_000; // default: daily
}

function isTaskDue(task: AgentTask): boolean {
  if (!task.lastRunAt) return true;
  const windowMs = scheduleToMs(task.schedule);
  return Date.now() - task.lastRunAt >= windowMs;
}

const AGENT_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: "web_fetch",
      description:
        "Fetch content from a URL via HTTP GET. Use for weather APIs, news feeds, web pages.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch" },
          },
          required: ["url"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "search_brain",
      description:
        "Search the user's brain for relevant context. Use to find related thoughts before completing the task.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for" },
          },
          required: ["query"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "capture_result",
      description:
        "Save the task result to the user's brain. Call this once with your final summary.",
      inputSchema: {
        json: {
          type: "object",
          properties: {
            text: { type: "string", description: "The result summary to save" },
          },
          required: ["text"],
        },
      },
    },
  },
];

async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  task: AgentTask,
  ownerContext: UserContext,
): Promise<string> {
  if (name === "web_fetch") {
    const url = args.url as string;
    if (isBlockedUrl(url)) return "Error: blocked URL (internal/metadata addresses not allowed)";
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "OpenBrain-AgentRunner/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      // Stream-read only up to MAX_FETCH_CHARS to avoid memory spikes
      const reader = res.body?.getReader();
      if (!reader) return "Error: no response body";
      const decoder = new TextDecoder();
      let text = "";
      while (text.length < MAX_FETCH_CHARS) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      reader.cancel();
      if (text.length > MAX_FETCH_CHARS) {
        text = text.slice(0, MAX_FETCH_CHARS) + "\n...(truncated)";
      }
      return text;
    } catch (e) {
      return `Fetch error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (name === "search_brain") {
    const query = args.query as string;
    return handleSearchThoughts(
      { query, limit: 10, scope: "private" },
      ownerContext,
    );
  }

  if (name === "capture_result") {
    const text = args.text as string;
    return handleCaptureThought(
      { text: `[agent-result: ${task.title}]\n${text}`, scope: "private" },
      ownerContext,
    );
  }

  throw new Error(`Unknown agent tool: ${name}`);
}

async function executeTask(
  task: AgentTask,
  ownerContext: UserContext,
): Promise<boolean> {
  let resultCaptured = false;
  const systemPrompt: SystemContentBlock[] = [
    {
      text: `You are a background agent executing a scheduled task for a user. Execute the action described below. Use web_fetch to get information from the internet. Use search_brain to find relevant context from the user's knowledge base. When you have a useful result, use capture_result to save a clear, concise summary. Be direct.`,
    },
  ];

  const messages: Message[] = [
    {
      role: "user",
      content: [
        { text: `Task: ${task.title}\nAction: ${task.action}\n\nExecute this task now.` },
      ],
    },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: CHAT_MODEL_ID,
        system: systemPrompt,
        messages,
        toolConfig: { tools: AGENT_TOOLS },
        inferenceConfig: { maxTokens: 2048 },
      }),
    );

    const outputMessage = response.output?.message;
    if (!outputMessage) break;
    messages.push(outputMessage);

    if (response.stopReason === "end_turn") break;

    if (response.stopReason === "tool_use") {
      const toolUseBlocks =
        outputMessage.content?.filter((b) => b.toolUse) ?? [];

      const toolResults: ContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const tu = block.toolUse!;
        let resultContent: ToolResultContentBlock[];
        try {
          const result = await executeAgentTool(
            tu.name!,
            (tu.input as Record<string, unknown>) ?? {},
            task,
            ownerContext,
          );
          if (tu.name === "capture_result") resultCaptured = true;
          resultContent = [{ text: result }];
        } catch (e) {
          resultContent = [
            { text: `Error: ${e instanceof Error ? e.message : String(e)}` },
          ];
        }
        toolResults.push({
          toolResult: { toolUseId: tu.toolUseId, content: resultContent },
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }

  return resultCaptured;
}

export async function handler(): Promise<void> {
  console.log("Agent runner starting...");

  const locked = await acquireRunLock();
  if (!locked) {
    console.log("Another invocation is already running — skipping.");
    return;
  }

  try {
    let tasks: AgentTask[];
    try {
      tasks = await getAllActiveTasks();
    } catch (e) {
      console.error("Failed to fetch tasks:", e);
      return;
    }

    const dueTasks = tasks.filter(isTaskDue);
    console.log(`Found ${tasks.length} active task(s), ${dueTasks.length} due`);

    // Limit tasks per invocation to stay within Lambda timeout
    const MAX_TASKS_PER_RUN = 5;
    const batch = dueTasks.slice(0, MAX_TASKS_PER_RUN);
    if (dueTasks.length > MAX_TASKS_PER_RUN) {
      console.log(`Processing first ${MAX_TASKS_PER_RUN} of ${dueTasks.length} due tasks`);
    }

    for (const task of batch) {
      const ownerContext: UserContext = {
        userId: task.userId,
        displayName: "Agent Runner",
      };

      try {
        console.log(`Executing "${task.title}" for user ${task.userId}...`);
        const captured = await executeTask(task, ownerContext);
        if (captured) {
          await updateTaskLastRun(task.userId, task.taskId);
          console.log(`Completed "${task.title}"`);
        } else {
        console.warn(`"${task.title}" finished without capturing a result — will retry next run`);
        }
      } catch (e) {
        console.error(`Failed to execute "${task.title}":`, e);
      }
    }

    console.log("Agent runner finished");
  } finally {
    await releaseRunLock();
  }
}
