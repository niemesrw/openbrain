import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { verifyAuth } from "./auth/verify";
import {
  handleScheduleTask,
  handleCancelTask,
} from "./handlers/agent-tasks";

const JSON_HEADERS = { "Content-Type": "application/json" };
const ddb = new DynamoDBClient({});

function unauthorized(): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Unauthorized" }),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // GET /tasks — list the authenticated user's scheduled tasks as JSON
  if (method === "GET" && path === "/tasks") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const TABLE_NAME = process.env.AGENT_TASKS_TABLE || "openbrain-agent-tasks";
      const result = await ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: "userId = :uid",
          ExpressionAttributeValues: { ":uid": { S: user.userId } },
        })
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
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ tasks }),
      };
    } catch (e) {
      console.error("List tasks error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // POST /tasks — create a new scheduled task
  if (method === "POST" && path === "/tasks") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    let body: { title?: unknown; schedule?: unknown; action?: unknown };
    try {
      body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }

    const { title, schedule, action } = body;
    if (!title || typeof title !== "string" || !title.trim()) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "title is required" }) };
    }
    if (!schedule || typeof schedule !== "string" || !schedule.trim()) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "schedule is required" }) };
    }
    if (!action || typeof action !== "string" || !action.trim()) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "action is required" }) };
    }

    try {
      const message = await handleScheduleTask(
        { title: title.trim(), schedule: schedule.trim(), action: action.trim() },
        user
      );
      return {
        statusCode: 201,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, message }),
      };
    } catch (e) {
      console.error("Create task error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  // DELETE /tasks/{taskId} — cancel a scheduled task
  if (method === "DELETE" && path.startsWith("/tasks/")) {
    const taskId = decodeURIComponent(path.slice("/tasks/".length));
    if (!taskId) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "taskId is required" }),
      };
    }

    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    try {
      const message = await handleCancelTask({ taskId }, user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true, message }),
      };
    } catch (e) {
      console.error("Cancel task error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Internal error" }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Not found" }),
  };
}
