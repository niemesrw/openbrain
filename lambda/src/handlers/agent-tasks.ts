import { randomUUID } from "crypto";
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import type { UserContext } from "../types";

const TABLE_NAME = process.env.AGENT_TASKS_TABLE || "openbrain-agent-tasks";
const ddb = new DynamoDBClient({});

export interface ScheduleTaskArgs {
  title: string;
  schedule: string;
  action: string;
}

export interface CancelTaskArgs {
  taskId: string;
}

export interface AgentTask {
  userId: string;
  taskId: string;
  title: string;
  schedule: string;
  action: string;
  status: string;
  lastRunAt: number | null;
  createdAt: number;
}

export async function handleScheduleTask(
  args: ScheduleTaskArgs,
  user: UserContext,
): Promise<string> {
  const taskId = randomUUID();
  const now = Date.now();

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        userId: { S: user.userId },
        taskId: { S: taskId },
        title: { S: args.title },
        schedule: { S: args.schedule },
        action: { S: args.action },
        status: { S: "active" },
        lastRunAt: { NULL: true },
        createdAt: { N: String(now) },
      },
    }),
  );

  return `Scheduled: "${args.title}" (${args.schedule}). Task ID: ${taskId}`;
}

export async function handleListTasks(
  _args: Record<string, unknown>,
  user: UserContext,
): Promise<string> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": { S: user.userId } },
    }),
  );

  const tasks = (result.Items ?? []).map((item) => ({
    taskId: item.taskId?.S ?? "",
    title: item.title?.S ?? "",
    schedule: item.schedule?.S ?? "",
    action: item.action?.S ?? "",
    status: item.status?.S ?? "",
    lastRunAt: item.lastRunAt?.N ? Number(item.lastRunAt.N) : null,
    createdAt: item.createdAt?.N ? Number(item.createdAt.N) : 0,
  }));

  if (tasks.length === 0) return "No scheduled tasks.";

  return tasks
    .map(
      (t) =>
        `• ${t.title} (${t.schedule}) — ${t.status}${t.lastRunAt ? `, last run: ${new Date(t.lastRunAt).toISOString()}` : ""}\n  ID: ${t.taskId}\n  Action: ${t.action}`,
    )
    .join("\n\n");
}

export async function handleCancelTask(
  args: CancelTaskArgs,
  user: UserContext,
): Promise<string> {
  const result = await ddb.send(
    new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: {
        userId: { S: user.userId },
        taskId: { S: args.taskId },
      },
      ReturnValues: "ALL_OLD",
    }),
  );

  if (!result.Attributes || Object.keys(result.Attributes).length === 0) {
    return `Task ${args.taskId} not found or already removed.`;
  }

  return `Task ${args.taskId} cancelled.`;
}

// Used by agent runner — scans all active tasks across all users
export async function getAllActiveTasks(): Promise<AgentTask[]> {
  const result = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#s = :active",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":active": { S: "active" } },
    }),
  );

  return (result.Items ?? []).map((item) => ({
    userId: item.userId?.S ?? "",
    taskId: item.taskId?.S ?? "",
    title: item.title?.S ?? "",
    schedule: item.schedule?.S ?? "",
    action: item.action?.S ?? "",
    status: item.status?.S ?? "",
    lastRunAt: item.lastRunAt?.N ? Number(item.lastRunAt.N) : null,
    createdAt: item.createdAt?.N ? Number(item.createdAt.N) : 0,
  }));
}

export async function updateTaskLastRun(
  userId: string,
  taskId: string,
): Promise<void> {
  const { UpdateItemCommand } = await import("@aws-sdk/client-dynamodb");
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        userId: { S: userId },
        taskId: { S: taskId },
      },
      UpdateExpression: "SET lastRunAt = :now",
      ExpressionAttributeValues: { ":now": { N: String(Date.now()) } },
    }),
  );
}
