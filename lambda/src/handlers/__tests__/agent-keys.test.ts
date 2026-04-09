import { handleListAgents, handleCreateAgent, handleRevokeAgent, handleRotateAgentKey } from "../agent-keys";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

jest.mock("../../services/api-key-hmac", () => ({
  hashApiKey: jest.fn().mockResolvedValue("test-hash-abc123"),
}));

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
    UpdateCommand: jest.fn((input: unknown) => ({ input })),
  };
});

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
const mockSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;

const USER = { userId: "user-123" };

beforeEach(() => {
  mockSend.mockReset();
  process.env.AGENT_KEYS_TABLE = "openbrain-agent-keys";
});

describe("handleCreateAgent — CLI snippet URL", () => {
  it("uses CUSTOM_DOMAIN when set", async () => {
    process.env.CUSTOM_DOMAIN = "brain.example.ai";
    mockSend.mockResolvedValue({});
    const result = await handleCreateAgent({ name: "test-agent" }, USER);
    expect(result).toContain("https://brain.example.ai/mcp");
    expect(result).not.toContain("<your-api-url>");
    delete process.env.CUSTOM_DOMAIN;
  });

  it("falls back to API_URL when CUSTOM_DOMAIN is absent", async () => {
    delete process.env.CUSTOM_DOMAIN;
    process.env.API_URL = "https://abc123.execute-api.us-east-1.amazonaws.com";
    mockSend.mockResolvedValue({});
    const result = await handleCreateAgent({ name: "test-agent" }, USER);
    expect(result).toContain("https://abc123.execute-api.us-east-1.amazonaws.com/mcp");
    expect(result).not.toContain("<your-api-url>");
    delete process.env.API_URL;
  });

  it("shows placeholder when neither env var is set", async () => {
    delete process.env.CUSTOM_DOMAIN;
    delete process.env.API_URL;
    mockSend.mockResolvedValue({});
    const result = await handleCreateAgent({ name: "test-agent" }, USER);
    expect(result).toContain("<your-api-url>/mcp");
  });
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

  it("stores keyHash instead of plaintext apiKey", async () => {
    const { hashApiKey } = jest.requireMock("../../services/api-key-hmac");
    mockSend.mockResolvedValue({});
    await handleCreateAgent({ name: "secure-agent" }, USER);

    const putCall = mockSend.mock.calls[0][0];
    const item = putCall.input.Item;
    expect(item.keyHash).toBe("test-hash-abc123");
    expect(item.apiKey).toBeUndefined();
    expect(hashApiKey).toHaveBeenCalledWith(expect.stringMatching(/^ob_/));
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

describe("handleRotateAgentKey", () => {
  beforeEach(() => {
    process.env.API_URL = "https://api.example.com";
  });

  it("returns new API key on successful rotation", async () => {
    mockSend.mockResolvedValue({});

    const result = await handleRotateAgentKey({ name: "claude-code" }, USER);

    expect(result).toContain('API key rotated for agent "claude-code"');
    expect(result).toContain("API Key: ob_");
    expect(result).toContain("claude mcp add");
    expect(result).toContain("https://api.example.com");
  });

  it("returns error when agent does not exist", async () => {
    const err = new Error("ConditionalCheckFailedException");
    err.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValue(err);

    const result = await handleRotateAgentKey({ name: "nonexistent" }, USER);

    expect(result).toBe('Error: Agent "nonexistent" not found.');
  });

  it("returns error when name is empty", async () => {
    const result = await handleRotateAgentKey({ name: "" }, USER);

    expect(result).toBe("Error: Agent name is required.");
  });

  it("returns error when name contains invalid characters", async () => {
    const result = await handleRotateAgentKey({ name: "bad agent!" }, USER);

    expect(result).toContain("Error: Agent name must be alphanumeric");
  });

  it("uses CUSTOM_DOMAIN when set", async () => {
    process.env.CUSTOM_DOMAIN = "brain.example.ai";
    mockSend.mockResolvedValue({});

    const result = await handleRotateAgentKey({ name: "claude-code" }, USER);

    expect(result).toContain("https://brain.example.ai/mcp");
    expect(result).not.toContain("<your-api-url>");
    delete process.env.CUSTOM_DOMAIN;
  });

  it("mentions propagation delay in response", async () => {
    mockSend.mockResolvedValue({});

    const result = await handleRotateAgentKey({ name: "claude-code" }, USER);

    expect(result).toContain("may continue to work briefly");
  });

  it("re-throws non-conditional-check errors", async () => {
    mockSend.mockRejectedValue(new Error("InternalServerError"));

    await expect(
      handleRotateAgentKey({ name: "test-agent" }, USER)
    ).rejects.toThrow("InternalServerError");
  });
});
