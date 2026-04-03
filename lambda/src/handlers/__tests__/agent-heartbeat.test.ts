import { handleAgentHeartbeat } from "../agent-heartbeat";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    DynamoDBClient: Client,
    UpdateItemCommand: jest.fn((input: unknown) => ({ input })),
  };
});

const mockSend = (DynamoDBClient as any).__mockSend as jest.Mock;

beforeEach(() => {
  mockSend.mockReset();
  (UpdateItemCommand as unknown as jest.Mock).mockClear();
  process.env.AGENT_KEYS_TABLE = "openbrain-agent-keys";
});

const AGENT_USER = { userId: "user-123", agentName: "claude-code" };

describe("handleAgentHeartbeat", () => {
  it("stores status and lastSeen in DynamoDB", async () => {
    mockSend.mockResolvedValue({});

    const result = await handleAgentHeartbeat({ status: "working" }, AGENT_USER);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = (UpdateItemCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmd.Key).toEqual({
      pk: { S: "USER#user-123" },
      sk: { S: "AGENT#claude-code" },
    });
    expect(cmd.ExpressionAttributeValues[":status"]).toEqual({ S: "working" });
    expect(cmd.ExpressionAttributeValues[":lastSeen"]).toBeDefined();
    expect(result).toBe("Heartbeat recorded: working");
  });

  it("includes message in response when provided", async () => {
    mockSend.mockResolvedValue({});

    const result = await handleAgentHeartbeat(
      { status: "working", message: "processing PR #42" },
      AGENT_USER
    );

    const cmd = (UpdateItemCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmd.ExpressionAttributeValues[":statusMessage"]).toEqual({
      S: "processing PR #42",
    });
    expect(result).toBe("Heartbeat recorded: working — processing PR #42");
  });

  it("does not include statusMessage attribute when message is omitted", async () => {
    mockSend.mockResolvedValue({});

    await handleAgentHeartbeat({ status: "idle" }, AGENT_USER);

    const cmd = (UpdateItemCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmd.ExpressionAttributeValues[":statusMessage"]).toBeUndefined();
  });

  it("returns error when called without agentName (user token)", async () => {
    const result = await handleAgentHeartbeat(
      { status: "idle" },
      { userId: "user-123" }
    );

    expect(mockSend).not.toHaveBeenCalled();
    expect(result).toContain("Error:");
  });

  it("returns error for invalid status", async () => {
    const result = await handleAgentHeartbeat(
      { status: "invalid" as any },
      AGENT_USER
    );

    expect(mockSend).not.toHaveBeenCalled();
    expect(result).toContain("Error:");
  });
});
