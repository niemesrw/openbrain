import { scheduleToMs, AGENT_TOOLS, executeAgentTool } from "../agent-runner";
import * as browseRecent from "../handlers/browse-recent";
import * as updateThought from "../handlers/update-thought";

jest.mock("../handlers/browse-recent");
jest.mock("../handlers/update-thought");
jest.mock("../handlers/search-thoughts");
jest.mock("../handlers/capture-thought");
jest.mock("../handlers/agent-tasks");
jest.mock("@aws-sdk/client-dynamodb", () => {
  const send = jest.fn().mockResolvedValue({});
  const Client = jest.fn(() => ({ send }));
  return {
    DynamoDBClient: Client,
    PutItemCommand: jest.fn((input: unknown) => ({ input })),
    DeleteItemCommand: jest.fn((input: unknown) => ({ input })),
  };
});
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn(() => ({ send: jest.fn() })),
  ConverseCommand: jest.fn((input: unknown) => ({ input })),
}));

const mockBrowseRecent = browseRecent.handleBrowseRecent as jest.MockedFunction<typeof browseRecent.handleBrowseRecent>;
const mockUpdateThought = updateThought.handleUpdateThought as jest.MockedFunction<typeof updateThought.handleUpdateThought>;

const TASK = { userId: "user-1", taskId: "t-1", title: "Test", action: "do it", schedule: "daily", status: "active" as const, lastRunAt: 0, createdAt: 0 };
const USER = { userId: "user-1", displayName: "Agent Runner" };

describe("scheduleToMs", () => {
  it("returns 1 hour for 'hourly'", () => {
    expect(scheduleToMs("hourly")).toBe(3_600_000);
  });

  it("returns 1 hour for 'every hour'", () => {
    expect(scheduleToMs("every hour")).toBe(3_600_000);
  });

  it("returns 7 days for 'weekly'", () => {
    expect(scheduleToMs("weekly")).toBe(604_800_000);
  });

  it("parses 'every 5 minutes'", () => {
    expect(scheduleToMs("every 5 minutes")).toBe(5 * 60_000);
  });

  it("parses 'every 30 min'", () => {
    expect(scheduleToMs("every 30 min")).toBe(30 * 60_000);
  });

  it("parses 'every 1 minute'", () => {
    expect(scheduleToMs("every 1 minute")).toBe(60_000);
  });

  it("parses 'every 2 hours'", () => {
    expect(scheduleToMs("every 2 hours")).toBe(2 * 3_600_000);
  });

  it("falls back to daily for 'every 0 minutes'", () => {
    expect(scheduleToMs("every 0 minutes")).toBe(86_400_000);
  });

  it("falls back to daily for 'every 0 hours'", () => {
    expect(scheduleToMs("every 0 hours")).toBe(86_400_000);
  });

  it("does not match 'every 5 minimum'", () => {
    // 'minimum' should not be parsed as minutes — falls through to daily
    expect(scheduleToMs("every 5 minimum")).toBe(86_400_000);
  });

  it("falls back to daily for unknown schedule", () => {
    expect(scheduleToMs("whenever I feel like it")).toBe(86_400_000);
  });

  it("minutes takes precedence over hours when both could match", () => {
    expect(scheduleToMs("every 10 minutes")).toBe(10 * 60_000);
  });
});

describe("AGENT_TOOLS", () => {
  it("includes browse_recent tool", () => {
    const names = AGENT_TOOLS.map((t) => t.toolSpec?.name);
    expect(names).toContain("browse_recent");
  });

  it("includes update_thought tool", () => {
    const names = AGENT_TOOLS.map((t) => t.toolSpec?.name);
    expect(names).toContain("update_thought");
  });

  it("browse_recent tool has no required fields", () => {
    const tool = AGENT_TOOLS.find((t) => t.toolSpec?.name === "browse_recent");
    const required = (tool?.toolSpec?.inputSchema?.json as { required?: string[] })?.required ?? [];
    expect(required).toEqual([]);
  });

  it("update_thought tool requires id and text", () => {
    const tool = AGENT_TOOLS.find((t) => t.toolSpec?.name === "update_thought");
    const required = (tool?.toolSpec?.inputSchema?.json as { required?: string[] })?.required ?? [];
    expect(required).toContain("id");
    expect(required).toContain("text");
  });
});

describe("executeAgentTool — browse_recent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls handleBrowseRecent with private scope and json format", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    const result = await executeAgentTool("browse_recent", {}, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "private", _format: "json" }),
      USER,
    );
    expect(result).toBe('{"thoughts":[]}');
  });

  it("passes limit, type, and topic when provided", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    await executeAgentTool("browse_recent", { limit: 5, type: "task", topic: "work" }, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, type: "task", topic: "work" }),
      USER,
    );
  });

  it("defaults limit to 10 when not provided", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    await executeAgentTool("browse_recent", {}, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
      USER,
    );
  });

  it("clamps limit to max 50", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    await executeAgentTool("browse_recent", { limit: 999 }, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
      USER,
    );
  });

  it("clamps limit to min 1", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    await executeAgentTool("browse_recent", { limit: -5 }, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
      USER,
    );
  });

  it("defaults limit to 10 for non-finite values", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    await executeAgentTool("browse_recent", { limit: Infinity }, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
      USER,
    );
  });

  it("ignores non-string type and topic", async () => {
    mockBrowseRecent.mockResolvedValue('{"thoughts":[]}');
    await executeAgentTool("browse_recent", { type: 42, topic: true }, TASK, USER);
    expect(mockBrowseRecent).toHaveBeenCalledWith(
      expect.objectContaining({ type: undefined, topic: undefined }),
      USER,
    );
  });
});

describe("executeAgentTool — update_thought", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls handleUpdateThought with id, text, and private scope", async () => {
    mockUpdateThought.mockResolvedValue("Updated as task — work");
    const result = await executeAgentTool(
      "update_thought",
      { id: "thought-abc", text: "updated content" },
      TASK,
      USER,
    );
    expect(mockUpdateThought).toHaveBeenCalledWith(
      { id: "thought-abc", text: "updated content", scope: "private" },
      USER,
    );
    expect(result).toBe("Updated as task — work");
  });

  it("throws when id is missing", async () => {
    await expect(
      executeAgentTool("update_thought", { text: "updated content" }, TASK, USER),
    ).rejects.toThrow("id is required");
  });

  it("throws when id is an empty string", async () => {
    await expect(
      executeAgentTool("update_thought", { id: "  ", text: "updated content" }, TASK, USER),
    ).rejects.toThrow("id is required");
  });

  it("throws when id is not a string", async () => {
    await expect(
      executeAgentTool("update_thought", { id: 123, text: "updated content" }, TASK, USER),
    ).rejects.toThrow("id is required");
  });
});
