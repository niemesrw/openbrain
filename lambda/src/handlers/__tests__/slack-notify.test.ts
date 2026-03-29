import type { SQSEvent, SQSRecord } from "aws-lambda";

const mockDdbSend = jest.fn();
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDdbSend })) },
  QueryCommand: jest.fn((...args: unknown[]) => ({ input: args[0] })),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Import after mocks are set up
import { handler } from "../../slack-notify";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/openbrain-slack-notify";

const INSTALLATION = {
  teamId: "T123",
  userId: "user-abc",
  slackUserId: "U456",
  accessToken: "xoxb-test-token",
};

function makeRecord(body: object): SQSRecord {
  return {
    messageId: "msg-1",
    receiptHandle: "rh-1",
    body: JSON.stringify(body),
    attributes: {} as SQSRecord["attributes"],
    messageAttributes: {},
    md5OfBody: "",
    eventSource: "aws:sqs",
    eventSourceARN: `${QUEUE_URL}`,
    awsRegion: "us-east-1",
  };
}

function makeEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SLACK_INSTALLATIONS_TABLE = "openbrain-slack-installations";

  // Default: DynamoDB returns one installation
  mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });

  // Default: conversations.open succeeds
  mockFetch.mockImplementation((url: string) => {
    if (url === "https://slack.com/api/conversations.open") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, channel: { id: "D789" } }),
      });
    }
    if (url === "https://slack.com/api/chat.postMessage") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });
});

describe("slack-notify handler", () => {
  it("posts a DM when user has a Slack installation and topic is channel:notify", async () => {
    const event = makeEvent([
      makeRecord({
        userId: "user-abc",
        thoughtId: "t-1",
        text: "Deployment finished",
        topics: ["channel:notify", "aws"],
      }),
    ]);

    await handler(event);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/conversations.open",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer xoxb-test-token" }),
      })
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer xoxb-test-token" }),
      })
    );
    const postBody = JSON.parse(
      (mockFetch.mock.calls.find(c => c[0] === "https://slack.com/api/chat.postMessage")![1] as { body: string }).body
    ) as { channel: string; text: string };
    expect(postBody.channel).toBe("D789");
    expect(postBody.text).toContain("channel:notify");
    expect(postBody.text).toContain("Deployment finished");
  });

  it("skips silently when user has no Slack installation", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });

    const event = makeEvent([
      makeRecord({
        userId: "user-no-slack",
        thoughtId: "t-2",
        text: "Some thought",
        topics: ["channel:alert"],
      }),
    ]);

    await handler(event);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts to shared channel when topic is channel:shared and slackChannelId is set", async () => {
    const installationWithChannel = { ...INSTALLATION, slackChannelId: "C-SHARED" };
    mockDdbSend.mockResolvedValue({ Items: [installationWithChannel] });

    const event = makeEvent([
      makeRecord({
        userId: "user-abc",
        thoughtId: "t-3",
        text: "Shared brain update",
        topics: ["channel:shared"],
      }),
    ]);

    await handler(event);

    // conversations.open should NOT be called — we use the configured channel directly
    expect(mockFetch).not.toHaveBeenCalledWith(
      "https://slack.com/api/conversations.open",
      expect.anything()
    );
    const postCall = mockFetch.mock.calls.find(c => c[0] === "https://slack.com/api/chat.postMessage");
    expect(postCall).toBeDefined();
    const postBody = JSON.parse((postCall![1] as { body: string }).body) as { channel: string };
    expect(postBody.channel).toBe("C-SHARED");
  });

  it("falls back to DM when topic is channel:shared but slackChannelId is not configured", async () => {
    const event = makeEvent([
      makeRecord({
        userId: "user-abc",
        thoughtId: "t-4",
        text: "Shared without config",
        topics: ["channel:shared"],
      }),
    ]);

    await handler(event);

    // Should call conversations.open to get DM channel
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/conversations.open",
      expect.anything()
    );
  });

  it("truncates long thought text to 200 chars in the notification", async () => {
    const longText = "A".repeat(300);

    const event = makeEvent([
      makeRecord({
        userId: "user-abc",
        thoughtId: "t-5",
        text: longText,
        topics: ["channel:notify"],
      }),
    ]);

    await handler(event);

    const postCall = mockFetch.mock.calls.find(c => c[0] === "https://slack.com/api/chat.postMessage");
    const body = JSON.parse((postCall![1] as { body: string }).body) as { text: string };
    expect(body.text).toContain("A".repeat(200));
    expect(body.text).toContain("\u2026"); // ellipsis
    expect(body.text).not.toContain("A".repeat(201));
  });

  it("handles malformed SQS record body gracefully", async () => {
    const badRecord: SQSRecord = {
      ...makeRecord({}),
      body: "not json {{{",
    };

    await expect(handler(makeEvent([badRecord]))).resolves.not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles DynamoDB lookup failure gracefully — continues to next record", async () => {
    mockDdbSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const event = makeEvent([
      makeRecord({
        userId: "user-abc",
        thoughtId: "t-6",
        text: "Some thought",
        topics: ["channel:notify"],
      }),
    ]);

    await expect(handler(event)).resolves.not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles Slack API failure gracefully — does not crash Lambda", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const event = makeEvent([
      makeRecord({
        userId: "user-abc",
        thoughtId: "t-7",
        text: "Some thought",
        topics: ["channel:alert"],
      }),
    ]);

    await expect(handler(event)).resolves.not.toThrow();
  });
});
