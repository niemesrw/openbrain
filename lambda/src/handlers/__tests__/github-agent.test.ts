import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";

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

jest.mock("@aws-sdk/client-bedrock-agentcore", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    BedrockAgentCoreClient: Client,
    InvokeAgentRuntimeCommand: jest.fn((input: unknown) => ({ input })),
  };
});

import { handler } from "../../github-agent";

const mockDdbSend = (DynamoDBDocumentClient as any).from.__mockSend as jest.Mock;
const mockAgentSend = (BedrockAgentCoreClient as any).__mockSend as jest.Mock;

const RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-1:123456789:runtime/test-123";

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
    payload: JSON.stringify({ action: "closed", pull_request: { merged: true } }),
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockDdbSend.mockReset();
  mockAgentSend.mockReset();
  mockAgentSend.mockResolvedValue({});
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
  process.env.GITHUB_AGENT_RUNTIME_ARN = RUNTIME_ARN;
});

afterEach(() => {
  delete process.env.GITHUB_AGENT_RUNTIME_ARN;
  delete process.env.GITHUB_INSTALLATIONS_TABLE;
});

describe("handler", () => {
  it("throws (triggering SQS retry/DLQ) when GITHUB_AGENT_RUNTIME_ARN is not set", async () => {
    delete process.env.GITHUB_AGENT_RUNTIME_ARN;
    await expect(handler(makeSqsEvent([makeMessage()]) as any)).rejects.toThrow(
      "GITHUB_AGENT_RUNTIME_ARN is not set"
    );
    expect(mockAgentSend).not.toHaveBeenCalled();
  });


  it("invokes AgentCore Runtime with the correct payload for a known installation", async () => {
    mockDdbSend.mockResolvedValue({
      Item: { installationId: "42", userId: "user-abc", accountLogin: "ryanniem", accountType: "User" },
    });

    await handler(makeSqsEvent([makeMessage()]) as any);

    expect(mockAgentSend).toHaveBeenCalledTimes(1);
    const cmd = mockAgentSend.mock.calls[0][0];
    expect(cmd.input.agentRuntimeArn).toBe(RUNTIME_ARN);
    expect(cmd.input.runtimeUserId).toBe("user-abc");
    expect(cmd.input.runtimeSessionId).toMatch(/^github-user-abc-\d+$/);

    const dispatched = JSON.parse(Buffer.from(cmd.input.payload).toString());
    expect(dispatched.eventType).toBe("pull_request");
    expect(dispatched.userId).toBe("user-abc");
    expect(dispatched.payload).toMatchObject({ action: "closed" });
  });

  it("skips records with no installationId", async () => {
    await handler(makeSqsEvent([makeMessage({ installationId: undefined })]) as any);

    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockAgentSend).not.toHaveBeenCalled();
  });

  it("skips records with unparseable body", async () => {
    await handler({ Records: [{ messageId: "x", body: "not json" }] } as any);

    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockAgentSend).not.toHaveBeenCalled();
  });

  it("skips records with unparseable payload", async () => {
    mockDdbSend.mockResolvedValue({
      Item: { installationId: "42", userId: "user-abc", accountLogin: "a", accountType: "User" },
    });

    await handler(makeSqsEvent([makeMessage({ payload: "not json" })]) as any);

    expect(mockAgentSend).not.toHaveBeenCalled();
  });

  it("skips when no installation is found for the id", async () => {
    mockDdbSend.mockResolvedValue({ Item: undefined });

    await handler(makeSqsEvent([makeMessage()]) as any);

    expect(mockAgentSend).not.toHaveBeenCalled();
  });

  it("continues processing remaining records when DynamoDB lookup fails", async () => {
    mockDdbSend
      .mockRejectedValueOnce(new Error("DDB error"))
      .mockResolvedValue({
        Item: { installationId: "43", userId: "user-xyz", accountLogin: "b", accountType: "User" },
      });

    await handler(
      makeSqsEvent([makeMessage({ installationId: 42 }), makeMessage({ installationId: 43 })]) as any
    );

    expect(mockAgentSend).toHaveBeenCalledTimes(1);
    const cmd = mockAgentSend.mock.calls[0][0];
    expect(cmd.input.runtimeUserId).toBe("user-xyz");
  });

  it("continues processing remaining records when AgentCore invocation fails", async () => {
    mockDdbSend.mockResolvedValue({
      Item: { installationId: "42", userId: "user-abc", accountLogin: "a", accountType: "User" },
    });
    mockAgentSend
      .mockRejectedValueOnce(new Error("throttled"))
      .mockResolvedValue({});

    await handler(
      makeSqsEvent([makeMessage(), makeMessage({ installationId: 43 })]) as any
    );

    // Both records attempted AgentCore; first failed but second succeeded
    expect(mockAgentSend).toHaveBeenCalledTimes(2);
  });

  it("processes multiple records in a single batch", async () => {
    mockDdbSend.mockResolvedValue({
      Item: { installationId: "42", userId: "user-abc", accountLogin: "a", accountType: "User" },
    });

    await handler(
      makeSqsEvent([
        makeMessage(),
        makeMessage({
          eventType: "push",
          payload: JSON.stringify({ ref: "refs/heads/main", commits: [{ message: "fix: bug" }] }),
        }),
        makeMessage({
          eventType: "release",
          payload: JSON.stringify({ action: "published", release: { tag_name: "v1.0.0" } }),
        }),
      ]) as any
    );

    expect(mockAgentSend).toHaveBeenCalledTimes(3);
  });

  it("skips non-actionable push events (tag deletions, empty commits)", async () => {
    await handler(
      makeSqsEvent([
        makeMessage({ eventType: "push", payload: JSON.stringify({ ref: "refs/tags/v1.0.0", commits: [] }) }),
        makeMessage({ eventType: "push", payload: JSON.stringify({ ref: "refs/heads/main", commits: [] }) }),
      ]) as any
    );
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockAgentSend).not.toHaveBeenCalled();
  });

  it("skips non-published release events", async () => {
    await handler(
      makeSqsEvent([makeMessage({ eventType: "release", payload: JSON.stringify({ action: "created" }) })]) as any
    );
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockAgentSend).not.toHaveBeenCalled();
  });

  it("skips unknown event types", async () => {
    await handler(
      makeSqsEvent([makeMessage({ eventType: "star" })]) as any
    );
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockAgentSend).not.toHaveBeenCalled();
  });
});
