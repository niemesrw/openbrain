import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const send = jest.fn();
  const from = jest.fn(() => ({ send }));
  (from as any).__mockSend = send;
  return {
    DynamoDBDocumentClient: { from },
    GetCommand: jest.fn((input: unknown) => ({ input })),
  };
});

const mockGenerateText = jest.fn();
jest.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  tool: (def: unknown) => def,
}));

jest.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: jest.fn(() => jest.fn((modelId: string) => modelId)),
}));

jest.mock("../../tool-executor", () => ({
  executeTool: jest.fn().mockResolvedValue("ok"),
}));

import { handler } from "../../github-agent";

const mockDdbSend = (DynamoDBDocumentClient as any).from.__mockSend as jest.Mock;

function makeSqsEvent(records: object[]) {
  return {
    Records: records.map((body) => ({
      messageId: "msg-1",
      body: JSON.stringify(body),
    })),
  };
}

function makeMessage(overrides: object = {}) {
  return {
    eventType: "pull_request",
    installationId: 42,
    payload: JSON.stringify({
      action: "closed",
      pull_request: { number: 99, title: "Fix bug", merged: true, state: "closed" },
      repository: { full_name: "BLANXLAIT/openbrain" },
    }),
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

const INSTALLATION = {
  installationId: "42",
  userId: "user-abc",
  accountLogin: "ryanniem",
  accountType: "User",
};

beforeEach(() => {
  mockDdbSend.mockReset();
  mockGenerateText.mockReset();
  mockGenerateText.mockResolvedValue({ steps: [] });
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
});

afterEach(() => {
  delete process.env.GITHUB_INSTALLATIONS_TABLE;
});

describe("handler", () => {
  it("invokes generateText with event context for a known installation", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(makeSqsEvent([makeMessage()]) as any);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const call = mockGenerateText.mock.calls[0][0];
    expect(call.system).toContain("GitHub Agent");
    expect(call.messages[0].content).toContain("pull_request");
    expect(call.messages[0].content).toContain("BLANXLAIT/openbrain");
    expect(call.maxSteps).toBe(10);
  });

  it("provides search, capture, and GitHub tools to the agent", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(makeSqsEvent([makeMessage()]) as any);

    const tools = mockGenerateText.mock.calls[0][0].tools;
    expect(tools).toHaveProperty("search_thoughts");
    expect(tools).toHaveProperty("capture_thought");
    expect(tools).toHaveProperty("browse_recent");
    expect(tools).toHaveProperty("github_label");
    expect(tools).toHaveProperty("github_comment");
    expect(tools).toHaveProperty("github_close");
  });

  it("scopes GitHub tools to the event's repository and hardcodes issue number", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(makeSqsEvent([makeMessage()]) as any);

    const tools = mockGenerateText.mock.calls[0][0].tools;
    // GitHub tool descriptions should mention the scoped repo and issue number
    expect(tools.github_label.description).toContain("BLANXLAIT/openbrain");
    expect(tools.github_label.description).toContain("#99");
    // issue_number should NOT be a parameter (hardcoded from event)
    expect(tools.github_label.parameters.shape).not.toHaveProperty("issue_number");
  });

  it("omits GitHub write tools when event has no issue/PR number (push events)", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(
      makeSqsEvent([
        makeMessage({
          eventType: "push",
          payload: JSON.stringify({
            ref: "refs/heads/main",
            commits: [{ message: "fix: bug" }],
            repository: { full_name: "BLANXLAIT/openbrain" },
          }),
        }),
      ]) as any
    );

    const tools = mockGenerateText.mock.calls[0][0].tools;
    expect(tools).toHaveProperty("search_thoughts");
    expect(tools).toHaveProperty("capture_thought");
    expect(tools).not.toHaveProperty("github_label");
    expect(tools).not.toHaveProperty("github_comment");
    expect(tools).not.toHaveProperty("github_close");
  });

  it("skips records with no installationId", async () => {
    await handler(makeSqsEvent([makeMessage({ installationId: undefined })]) as any);

    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("skips records with unparseable body", async () => {
    await handler({ Records: [{ messageId: "x", body: "not json" }] } as any);

    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("skips records with unparseable payload", async () => {
    await handler(makeSqsEvent([makeMessage({ payload: "not json" })]) as any);

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("skips when no installation is found", async () => {
    mockDdbSend.mockResolvedValue({ Item: undefined });

    await handler(makeSqsEvent([makeMessage()]) as any);

    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("continues processing remaining records when DynamoDB lookup fails", async () => {
    mockDdbSend
      .mockRejectedValueOnce(new Error("DDB error"))
      .mockResolvedValue({ Item: { ...INSTALLATION, installationId: "43", userId: "user-xyz" } });

    await handler(
      makeSqsEvent([makeMessage({ installationId: 42 }), makeMessage({ installationId: 43 })]) as any
    );

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("continues processing remaining records when agent execution fails", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });
    mockGenerateText
      .mockRejectedValueOnce(new Error("bedrock throttled"))
      .mockResolvedValue({ steps: [] });

    await handler(
      makeSqsEvent([makeMessage(), makeMessage({ installationId: 43 })]) as any
    );

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("processes multiple records in a single batch", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(
      makeSqsEvent([
        makeMessage(),
        makeMessage({
          eventType: "push",
          payload: JSON.stringify({
            ref: "refs/heads/main",
            commits: [{ message: "fix: bug" }],
            repository: { full_name: "BLANXLAIT/openbrain" },
          }),
        }),
        makeMessage({
          eventType: "release",
          payload: JSON.stringify({
            action: "published",
            release: { tag_name: "v1.0.0", name: "v1.0.0" },
            repository: { full_name: "BLANXLAIT/openbrain" },
          }),
        }),
      ]) as any
    );

    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  it("skips non-actionable push events (tag deletions, empty commits)", async () => {
    await handler(
      makeSqsEvent([
        makeMessage({ eventType: "push", payload: JSON.stringify({ ref: "refs/tags/v1.0.0", commits: [] }) }),
        makeMessage({ eventType: "push", payload: JSON.stringify({ ref: "refs/heads/main", commits: [] }) }),
      ]) as any
    );
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("skips non-published release events", async () => {
    await handler(
      makeSqsEvent([makeMessage({ eventType: "release", payload: JSON.stringify({ action: "created" }) })]) as any
    );
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("skips unknown event types", async () => {
    await handler(
      makeSqsEvent([makeMessage({ eventType: "star" })]) as any
    );
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("dispatches issues events", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(
      makeSqsEvent([
        makeMessage({
          eventType: "issues",
          payload: JSON.stringify({
            action: "opened",
            issue: { number: 5, title: "Bug report" },
            repository: { full_name: "BLANXLAIT/openbrain" },
          }),
        }),
      ]) as any
    );

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(mockGenerateText.mock.calls[0][0].messages[0].content).toContain("issues");
  });

  it("wraps event details in XML delimiters in the agent prompt", async () => {
    mockDdbSend.mockResolvedValue({ Item: INSTALLATION });

    await handler(makeSqsEvent([makeMessage()]) as any);

    const content = mockGenerateText.mock.calls[0][0].messages[0].content;
    expect(content).toContain("<github-event>");
    expect(content).toContain("</github-event>");
    expect(content).toContain("PR #99");
    expect(content).toContain("Fix bug");
    expect(content).toContain("merged");
    // Bodies should NOT appear in the summary (prompt injection risk)
    expect(content).not.toContain("Description:");
  });
});
