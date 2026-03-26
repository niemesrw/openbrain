import {
  handleScheduleTask,
  handleListTasks,
  handleCancelTask,
  getAllActiveTasks,
} from "../agent-tasks";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    DynamoDBClient: Client,
    PutItemCommand: jest.fn((input: unknown) => ({ input })),
    QueryCommand: jest.fn((input: unknown) => ({ input })),
    DeleteItemCommand: jest.fn((input: unknown) => ({ input })),
    ScanCommand: jest.fn((input: unknown) => ({ input })),
    UpdateItemCommand: jest.fn((input: unknown) => ({ input })),
  };
});

const mockSend = (DynamoDBClient as any).__mockSend as jest.Mock;
const USER = { userId: "user-123" };

beforeEach(() => {
  mockSend.mockReset();
});

describe("handleScheduleTask", () => {
  it("puts item in DynamoDB and returns confirmation with taskId", async () => {
    
    mockSend.mockResolvedValue({});

    const result = await handleScheduleTask(
      { title: "Check HN", schedule: "every 5 minutes", action: "fetch https://news.ycombinator.com" },
      USER
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toContain('Scheduled: "Check HN"');
    expect(result).toContain("every 5 minutes");
    expect(result).toMatch(/Task ID: [0-9a-f-]{36}/);
  });
});

describe("handleListTasks", () => {
  it("returns 'No scheduled tasks.' when table is empty", async () => {
    
    mockSend.mockResolvedValue({ Items: [] });

    const result = await handleListTasks({}, USER);

    expect(result).toBe("No scheduled tasks.");
  });

  it("formats tasks correctly", async () => {
    
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

    const result = await handleListTasks({}, USER);

    expect(result).toContain("Check HN");
    expect(result).toContain("daily");
    expect(result).toContain("active");
    expect(result).toContain("task-1");
  });

  it("includes last run time when present", async () => {
    
    mockSend.mockResolvedValue({
      Items: [
        {
          taskId: { S: "task-1" },
          title: { S: "Check HN" },
          schedule: { S: "daily" },
          action: { S: "fetch" },
          status: { S: "active" },
          lastRunAt: { N: "1700000000000" },
          createdAt: { N: "1699000000000" },
        },
      ],
    });

    const result = await handleListTasks({}, USER);
    expect(result).toContain("last run:");
  });
});

describe("handleCancelTask", () => {
  it("deletes task and returns confirmation when task exists", async () => {
    mockSend.mockResolvedValue({
      Attributes: {
        userId: { S: "user-123" },
        taskId: { S: "task-1" },
        title: { S: "Check HN" },
      },
    });

    const result = await handleCancelTask({ taskId: "task-1" }, USER);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toBe("Task task-1 cancelled.");
  });

  it("returns not-found message when task does not exist", async () => {
    mockSend.mockResolvedValue({ Attributes: undefined });

    const result = await handleCancelTask({ taskId: "nonexistent" }, USER);

    expect(result).toBe("Task nonexistent not found or already removed.");
  });

  it("returns not-found message when Attributes is empty", async () => {
    mockSend.mockResolvedValue({ Attributes: {} });

    const result = await handleCancelTask({ taskId: "gone" }, USER);

    expect(result).toBe("Task gone not found or already removed.");
  });
});

describe("getAllActiveTasks", () => {
  it("returns empty array when no active tasks", async () => {
    
    mockSend.mockResolvedValue({ Items: [] });

    const result = await getAllActiveTasks();
    expect(result).toEqual([]);
  });

  it("maps DynamoDB items to AgentTask objects", async () => {
    
    mockSend.mockResolvedValue({
      Items: [
        {
          userId: { S: "user-123" },
          taskId: { S: "task-1" },
          title: { S: "Check weather" },
          schedule: { S: "every 30 min" },
          action: { S: "fetch https://weather.com" },
          status: { S: "active" },
          lastRunAt: { N: "1700000000000" },
          createdAt: { N: "1699000000000" },
        },
      ],
    });

    const result = await getAllActiveTasks();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: "user-123",
      taskId: "task-1",
      title: "Check weather",
      schedule: "every 30 min",
      lastRunAt: 1700000000000,
    });
  });

  it("sets lastRunAt to null when NULL in DynamoDB", async () => {
    
    mockSend.mockResolvedValue({
      Items: [
        {
          userId: { S: "user-123" },
          taskId: { S: "task-1" },
          title: { S: "Check weather" },
          schedule: { S: "daily" },
          action: { S: "fetch" },
          status: { S: "active" },
          lastRunAt: { NULL: true },
          createdAt: { N: "1699000000000" },
        },
      ],
    });

    const [task] = await getAllActiveTasks();
    expect(task.lastRunAt).toBeNull();
  });
});
