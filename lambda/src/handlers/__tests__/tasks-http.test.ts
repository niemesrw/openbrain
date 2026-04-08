import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { handler } from "../../tasks";

/** `APIGatewayProxyResultV2` is `string | object` — narrow to the object variant used by our handler. */
function asResult(r: APIGatewayProxyResultV2): { statusCode: number; body: string } {
  return r as { statusCode: number; body: string };
}

// --- Mock DynamoDB ---
jest.mock("@aws-sdk/client-dynamodb", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    DynamoDBClient: Client,
    QueryCommand: jest.fn((input: unknown) => ({ input })),
  };
});

// --- Mock handlers ---
jest.mock("../../handlers/agent-tasks", () => ({
  handleScheduleTask: jest.fn(),
  handleCancelTask: jest.fn(),
}));

// --- Mock auth ---
jest.mock("../../auth/verify", () => ({
  verifyAuth: jest.fn(),
}));

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { handleScheduleTask, handleCancelTask } from "../../handlers/agent-tasks";
import { verifyAuth } from "../../auth/verify";

const mockSend = (DynamoDBClient as any).__mockSend as jest.Mock;
const mockScheduleTask = handleScheduleTask as jest.Mock;
const mockCancelTask = handleCancelTask as jest.Mock;
const mockVerifyAuth = verifyAuth as jest.Mock;

const USER = { userId: "user-123", agentName: undefined };

function makeEvent(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {}
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "", userAgent: "" },
      accountId: "",
      apiId: "",
      domainName: "",
      domainPrefix: "",
      requestId: "",
      routeKey: "",
      stage: "",
      time: "",
      timeEpoch: 0,
    },
    rawPath: path,
    rawQueryString: "",
    headers,
    body,
    isBase64Encoded: false,
    version: "2.0",
    routeKey: "",
    stageVariables: undefined,
    pathParameters: undefined,
    queryStringParameters: undefined,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyAuth.mockResolvedValue(USER);
});

// ---------------------------------------------------------------------------
// GET /tasks
// ---------------------------------------------------------------------------

describe("GET /tasks", () => {
  it("returns 401 when auth fails", async () => {
    mockVerifyAuth.mockRejectedValue(new Error("Unauthorized"));
    const rawRes = await handler(makeEvent("GET", "/tasks"));
    expect(asResult(rawRes).statusCode).toBe(401);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ error: "Unauthorized" });
  });

  it("returns empty tasks array when no tasks exist", async () => {
    mockSend.mockResolvedValue({ Items: [] });
    const rawRes = await handler(makeEvent("GET", "/tasks"));
    expect(asResult(rawRes).statusCode).toBe(200);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ tasks: [] });
  });

  it("returns mapped tasks list", async () => {
    mockSend.mockResolvedValue({
      Items: [
        {
          taskId: { S: "task-1" },
          title: { S: "Check HN" },
          schedule: { S: "daily" },
          action: { S: "fetch https://news.ycombinator.com" },
          status: { S: "active" },
          lastRunAt: { NULL: true },
          createdAt: { N: "1700000000000" },
        },
      ],
    });
    const rawRes = await handler(makeEvent("GET", "/tasks"));
    expect(asResult(rawRes).statusCode).toBe(200);
    const body = JSON.parse(asResult(rawRes).body);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({
      taskId: "task-1",
      title: "Check HN",
      schedule: "daily",
      lastRunAt: null,
    });
  });

  it("returns 500 on DynamoDB error", async () => {
    mockSend.mockRejectedValue(new Error("DDB failure"));
    const rawRes = await handler(makeEvent("GET", "/tasks"));
    expect(asResult(rawRes).statusCode).toBe(500);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ error: "Internal error" });
  });
});

// ---------------------------------------------------------------------------
// POST /tasks
// ---------------------------------------------------------------------------

describe("POST /tasks", () => {
  it("returns 401 when auth fails", async () => {
    mockVerifyAuth.mockRejectedValue(new Error("Unauthorized"));
    const rawRes = await handler(
      makeEvent("POST", "/tasks", JSON.stringify({ title: "t", schedule: "daily", action: "a" }))
    );
    expect(asResult(rawRes).statusCode).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    const rawRes = await handler(makeEvent("POST", "/tasks", "not-json"));
    expect(asResult(rawRes).statusCode).toBe(400);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ error: "Invalid JSON" });
  });

  it("returns 400 when title is missing", async () => {
    const rawRes = await handler(
      makeEvent("POST", "/tasks", JSON.stringify({ schedule: "daily", action: "do it" }))
    );
    expect(asResult(rawRes).statusCode).toBe(400);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ error: "title is required" });
  });

  it("returns 400 when schedule is missing", async () => {
    const rawRes = await handler(
      makeEvent("POST", "/tasks", JSON.stringify({ title: "My task", action: "do it" }))
    );
    expect(asResult(rawRes).statusCode).toBe(400);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ error: "schedule is required" });
  });

  it("returns 400 when action is missing", async () => {
    const rawRes = await handler(
      makeEvent("POST", "/tasks", JSON.stringify({ title: "My task", schedule: "daily" }))
    );
    expect(asResult(rawRes).statusCode).toBe(400);
    expect(JSON.parse(asResult(rawRes).body)).toEqual({ error: "action is required" });
  });

  it("creates task and returns 201 with message", async () => {
    mockScheduleTask.mockResolvedValue('Scheduled: "My task" (daily). Task ID: abc-123');
    const rawRes = await handler(
      makeEvent(
        "POST",
        "/tasks",
        JSON.stringify({ title: "My task", schedule: "daily", action: "fetch https://example.com" })
      )
    );
    expect(asResult(rawRes).statusCode).toBe(201);
    const body = JSON.parse(asResult(rawRes).body);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("Scheduled");
    expect(mockScheduleTask).toHaveBeenCalledWith(
      { title: "My task", schedule: "daily", action: "fetch https://example.com" },
      USER
    );
  });

  it("returns 500 on handler error", async () => {
    mockScheduleTask.mockRejectedValue(new Error("DDB failure"));
    const rawRes = await handler(
      makeEvent("POST", "/tasks", JSON.stringify({ title: "t", schedule: "daily", action: "a" }))
    );
    expect(asResult(rawRes).statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /tasks/{taskId}
// ---------------------------------------------------------------------------

describe("DELETE /tasks/{taskId}", () => {
  it("returns 401 when auth fails", async () => {
    mockVerifyAuth.mockRejectedValue(new Error("Unauthorized"));
    const rawRes = await handler(makeEvent("DELETE", "/tasks/task-1"));
    expect(asResult(rawRes).statusCode).toBe(401);
  });

  it("cancels task and returns 200 with message", async () => {
    mockCancelTask.mockResolvedValue("Task task-1 cancelled.");
    const rawRes = await handler(makeEvent("DELETE", "/tasks/task-1"));
    expect(asResult(rawRes).statusCode).toBe(200);
    const body = JSON.parse(asResult(rawRes).body);
    expect(body.ok).toBe(true);
    expect(body.message).toBe("Task task-1 cancelled.");
    expect(mockCancelTask).toHaveBeenCalledWith({ taskId: "task-1" }, USER);
  });

  it("returns 200 with not-found message when task does not exist", async () => {
    mockCancelTask.mockResolvedValue("Task nonexistent not found or already removed.");
    const rawRes = await handler(makeEvent("DELETE", "/tasks/nonexistent"));
    expect(asResult(rawRes).statusCode).toBe(200);
    const body = JSON.parse(asResult(rawRes).body);
    expect(body.message).toContain("not found");
  });

  it("returns 500 on handler error", async () => {
    mockCancelTask.mockRejectedValue(new Error("DDB failure"));
    const rawRes = await handler(makeEvent("DELETE", "/tasks/task-1"));
    expect(asResult(rawRes).statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Fallback 404
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  it("returns 404 for unrecognised path", async () => {
    const rawRes = await handler(makeEvent("GET", "/unknown"));
    expect(asResult(rawRes).statusCode).toBe(404);
  });
});
