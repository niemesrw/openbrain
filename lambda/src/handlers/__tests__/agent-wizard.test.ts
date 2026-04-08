import { handleUpdateAgent } from "../agent-wizard";

// Mock libsodium (required by agent-wizard module)
jest.mock("libsodium-wrappers", () => ({
  __esModule: true,
  default: {
    ready: Promise.resolve(),
    from_base64: jest.fn(() => new Uint8Array(32)),
    from_string: jest.fn(() => new Uint8Array(10)),
    crypto_box_seal: jest.fn(() => new Uint8Array(48)),
    to_base64: jest.fn(() => "encrypted-base64"),
    base64_variants: { ORIGINAL: 0 },
  },
}));

jest.mock("../../services/api-key-hmac", () => ({
  hashApiKey: jest.fn().mockResolvedValue("test-hash"),
}));

jest.mock("../../services/github-app", () => ({
  getInstallationToken: jest.fn().mockResolvedValue("ghs_mock_token"),
}));

jest.mock("@aws-sdk/client-dynamodb", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return { DynamoDBClient: Client };
});

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const send = jest.fn();
  const from = jest.fn(() => ({ send }));
  (from as any).__mockSend = send;
  return {
    DynamoDBDocumentClient: { from },
    PutCommand: jest.fn((input: unknown) => ({ input })),
    QueryCommand: jest.fn((input: unknown) => ({ input })),
  };
});

// Mock global fetch for GitHub API calls
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
const mockSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;

const USER = { userId: "user-123" };

beforeEach(() => {
  mockSend.mockReset();
  mockFetch.mockReset();
  process.env.AGENT_KEYS_TABLE = "openbrain-agent-keys";
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
});

describe("handleUpdateAgent", () => {
  it("rejects when caller is an agent", async () => {
    const agentUser = { userId: "user-123", agentName: "my-agent" };
    await expect(
      handleUpdateAgent({ name: "test-agent" }, agentUser)
    ).rejects.toThrow("Agents cannot update agents");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects invalid agent names", async () => {
    await expect(
      handleUpdateAgent({ name: "bad name!" }, USER)
    ).rejects.toThrow("Agent name must be alphanumeric");
  });

  it("rejects invalid cron schedule", async () => {
    await expect(
      handleUpdateAgent({ name: "test-agent", schedule: "not a cron" }, USER)
    ).rejects.toThrow("Invalid cron schedule");
  });

  it("throws when agent not found", async () => {
    mockSend
      // Agent lookup — no items
      .mockResolvedValueOnce({ Items: [] });

    await expect(
      handleUpdateAgent({ name: "missing-agent" }, USER)
    ).rejects.toThrow('Agent "missing-agent" not found');
  });

  it("throws when agent has no linked repo", async () => {
    mockSend
      // Agent lookup — found but no repoFullName
      .mockResolvedValueOnce({
        Items: [{ pk: "USER#user-123", sk: "AGENT#test", agentName: "test" }],
      });

    await expect(
      handleUpdateAgent({ name: "test" }, USER)
    ).rejects.toThrow('Agent "test" has no linked repo');
  });

  it("throws when no GitHub connection", async () => {
    mockSend
      // Agent lookup
      .mockResolvedValueOnce({
        Items: [{ pk: "USER#user-123", sk: "AGENT#test", repoFullName: "org/repo" }],
      })
      // Installation lookup — none
      .mockResolvedValueOnce({ Items: [] });

    await expect(
      handleUpdateAgent({ name: "test" }, USER)
    ).rejects.toThrow("No GitHub connection found");
  });

  it("sets repo variables on success", async () => {
    mockSend
      // Agent lookup
      .mockResolvedValueOnce({
        Items: [{ pk: "USER#user-123", sk: "AGENT#test", repoFullName: "org/brain-agent-test" }],
      })
      // Installation lookup
      .mockResolvedValueOnce({
        Items: [{ installationId: "inst-1", accountLogin: "org" }],
      });

    // GitHub API calls: PATCH variable (success for each)
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    const result = await handleUpdateAgent(
      { name: "test", systemPrompt: "New prompt", model: "openai/gpt-4o" },
      USER
    );

    expect(result).toEqual({ ok: true });
    // systemPrompt maps to AGENT_USER_PROMPT (task prompt), plus AGENT_MODEL
    const patchCalls = mockFetch.mock.calls.filter(
      (c: any[]) => c[1]?.method === "PATCH"
    );
    expect(patchCalls.length).toBe(2);
    expect(patchCalls[0][0]).toContain("AGENT_USER_PROMPT");
    expect(patchCalls[1][0]).toContain("AGENT_MODEL");
  });

  it("falls back to POST when PATCH returns 404", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ pk: "USER#user-123", sk: "AGENT#test", repoFullName: "org/brain-agent-test" }],
      })
      .mockResolvedValueOnce({
        Items: [{ installationId: "inst-1", accountLogin: "org" }],
      });

    mockFetch
      // PATCH AGENT_USER_PROMPT → 404
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // POST AGENT_USER_PROMPT → success
      .mockResolvedValueOnce({ ok: true, status: 201 });

    const result = await handleUpdateAgent(
      { name: "test", systemPrompt: "New prompt" },
      USER
    );

    expect(result).toEqual({ ok: true });
    const postCalls = mockFetch.mock.calls.filter(
      (c: any[]) => c[1]?.method === "POST"
    );
    expect(postCalls.length).toBe(1);
  });

  it("throws when GitHub variable API fails with non-404", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ pk: "USER#user-123", sk: "AGENT#test", repoFullName: "org/brain-agent-test" }],
      })
      .mockResolvedValueOnce({
        Items: [{ installationId: "inst-1", accountLogin: "org" }],
      });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });

    await expect(
      handleUpdateAgent({ name: "test", systemPrompt: "New prompt" }, USER)
    ).rejects.toThrow("Failed to update variable AGENT_USER_PROMPT: 403");
  });
});
