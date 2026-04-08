import { handleListAgents, handleCreateAgent, handleRevokeAgent } from "../agent-keys";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    DynamoDBClient: Client,
    QueryCommand: jest.fn((input: unknown) => ({ input })),
    PutCommand: jest.fn((input: unknown) => ({ input })),
    DeleteCommand: jest.fn((input: unknown) => ({ input })),
  };
});

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const send = jest.fn();
  const from = jest.fn(() => ({ send }));
  (from as any).__mockSend = send;
  return {
    DynamoDBDocumentClient: { from },
    PutCommand: jest.fn((input: unknown) => ({ input })),
    QueryCommand: jest.fn((input: unknown) => ({ input })),
    DeleteCommand: jest.fn((input: unknown) => ({ input })),
  };
});

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
const mockSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;

const USER = { userId: "user-123" };

beforeEach(() => {
  mockSend.mockReset();
  process.env.AGENT_KEYS_TABLE = "openbrain-agent-keys";
});

describe("handleCreateAgent — agent caller restriction", () => {
  it("rejects when caller is an agent", async () => {
    const agentUser = { userId: "user-123", agentName: "my-agent" };
    const result = await handleCreateAgent({ name: "new-agent" }, agentUser);
    expect(result).toContain("Error:");
    expect(result).toContain("Agents cannot create new agent keys");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("allows when caller is a JWT user (no agentName)", async () => {
    mockSend.mockResolvedValue({});
    const result = await handleCreateAgent({ name: "new-agent" }, USER);
    expect(result).toContain("Agent \"new-agent\" created.");
    expect(result).toContain("API Key:");
  });
});

describe("handleRevokeAgent — agent caller restriction", () => {
  it("rejects when agent tries to revoke a different agent", async () => {
    const agentUser = { userId: "user-123", agentName: "agent-a" };
    const result = await handleRevokeAgent({ name: "agent-b" }, agentUser);
    expect(result).toContain("Error:");
    expect(result).toContain("Agents can only revoke themselves");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("allows agent to revoke itself", async () => {
    mockSend.mockResolvedValue({});
    const agentUser = { userId: "user-123", agentName: "agent-a" };
    const result = await handleRevokeAgent({ name: "agent-a" }, agentUser);
    expect(result).toContain("Agent \"agent-a\" revoked.");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("allows JWT user to revoke any agent", async () => {
    mockSend.mockResolvedValue({});
    const result = await handleRevokeAgent({ name: "any-agent" }, USER);
    expect(result).toContain("Agent \"any-agent\" revoked.");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

describe("handleListAgents — heartbeat fields", () => {
  it("includes status fields in JSON response", async () => {
    const recentTime = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    mockSend.mockResolvedValue({
      Items: [
        {
          agentName: "claude-code",
          createdAt: "2026-01-01T00:00:00Z",
          lastSeen: recentTime,
          status: "working",
          statusMessage: "processing PR",
        },
      ],
    });

    const result = await handleListAgents({ _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.agents[0].status).toBe("working");
    expect(parsed.agents[0].lastSeen).toBe(recentTime);
    expect(parsed.agents[0].statusMessage).toBe("processing PR");
  });

  it("marks agent as stale when lastSeen is >5 min ago", async () => {
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockSend.mockResolvedValue({
      Items: [
        {
          agentName: "old-bot",
          createdAt: "2026-01-01T00:00:00Z",
          lastSeen: staleTime,
          status: "idle",
        },
      ],
    });

    const result = await handleListAgents({ _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.agents[0].status).toBe("stale");
  });

  it("returns unknown status when lastSeen is absent", async () => {
    mockSend.mockResolvedValue({
      Items: [
        {
          agentName: "new-bot",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const result = await handleListAgents({ _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.agents[0].status).toBe("unknown");
    expect(parsed.agents[0].lastSeen).toBeNull();
  });

  it("includes status in text format", async () => {
    const recentTime = new Date(Date.now() - 30_000).toISOString();
    mockSend.mockResolvedValue({
      Items: [
        {
          agentName: "my-agent",
          createdAt: "2026-01-01T00:00:00Z",
          lastSeen: recentTime,
          status: "idle",
          statusMessage: "waiting",
        },
      ],
    });

    const result = await handleListAgents({}, USER);

    expect(result).toContain("[idle");
    expect(result).toContain("waiting");
    expect(result).toContain("my-agent");
  });

  it("returns no agents message when empty", async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const result = await handleListAgents({}, USER);

    expect(result).toBe("No agents registered. Use create_agent to create one.");
  });
});
