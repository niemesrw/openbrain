import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const send = jest.fn();
  const from = jest.fn(() => ({ send }));
  (from as any).__mockSend = send;
  return {
    DynamoDBDocumentClient: { from },
    QueryCommand: jest.fn((input: unknown) => ({ input })),
  };
});

const mockLambdaInvoke = jest.fn();
jest.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: jest.fn(() => ({ send: mockLambdaInvoke })),
  InvokeCommand: jest.fn((input: unknown) => ({ input })),
}));

import { handleSlackEvent } from "../slack-event";

const mockDdbSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;

const INSTALLATION = {
  teamId: "T123",
  userId: "user-abc",
  slackUserId: "U456",
  accessToken: "xoxb-test-token",
  botUserId: "B789",
  teamName: "BLANXLAIT",
};

beforeEach(() => {
  mockDdbSend.mockReset();
  mockLambdaInvoke.mockReset();
  mockLambdaInvoke.mockResolvedValue({});
  process.env.SLACK_INSTALLATIONS_TABLE = "openbrain-slack-installations";
  process.env.SLACK_DEFERRED_FUNCTION_NAME = "slack-deferred-fn";
});

type Result = { statusCode: number; body: string; headers?: Record<string, string> };

// --- Slash commands ---

function makeSlashPayload(text: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "slash_command",
    command: "/brain",
    text,
    team_id: "T123",
    user_id: "U456",
    channel_id: "C123",
    response_url: "https://hooks.slack.com/commands/123",
    ...overrides,
  };
}

function getDeferredPayload(): Record<string, unknown> {
  const call = mockLambdaInvoke.mock.calls[0][0];
  return JSON.parse(call.input.Payload as string);
}

describe("handleSlackEvent - slash command", () => {
  it("acks immediately and invokes deferred Lambda for /brain search <query>", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("search auth decisions"))) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toContain("Searching");
    expect(mockLambdaInvoke).toHaveBeenCalledTimes(1);
    const deferred = getDeferredPayload();
    expect(deferred.type).toBe("slash_search");
    expect(deferred.query).toBe("auth decisions");
    expect(deferred.userId).toBe("user-abc");
    expect(deferred.responseUrl).toBe("https://hooks.slack.com/commands/123");
  });

  it("acks immediately and invokes deferred Lambda for /brain capture <text>", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("capture My great idea"))) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toContain("Capturing");
    expect(mockLambdaInvoke).toHaveBeenCalledTimes(1);
    const deferred = getDeferredPayload();
    expect(deferred.type).toBe("slash_capture");
    expect(deferred.text).toBe("My great idea");
    expect(deferred.userId).toBe("user-abc");
  });

  it("returns help text for /brain help", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("help"))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("search");
    expect(body.text).toContain("capture");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("returns help text for /brain with no subcommand", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload(""))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("search");
    expect(body.text).toContain("capture");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("treats unrecognized text as a search query", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("what did I decide about auth?"))) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toContain("Searching");
    const deferred = getDeferredPayload();
    expect(deferred.type).toBe("slash_search");
    expect(deferred.query).toBe("what did I decide about auth?");
  });

  it("returns usage hint when /brain search has no query", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("search"))) as Result;
    expect(JSON.parse(result.body).text).toContain("Usage");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("returns usage hint when /brain capture has no text", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("capture"))) as Result;
    expect(JSON.parse(result.body).text).toContain("Usage");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("returns error message when installation not found", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    const result = (await handleSlackEvent(makeSlashPayload("search test"))) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toContain("Connect at brain.blanxlait.ai");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("prompts unlinked Slack users to connect their brain", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    const result = (await handleSlackEvent(makeSlashPayload("search test", { user_id: "U-other" }))) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toContain("Connect at brain.blanxlait.ai");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("looks up installation by teamId + slackUserId (per-user, not per-team)", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    await handleSlackEvent(makeSlashPayload("search test"));
    const queryInput = mockDdbSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe("team-slack-user-index");
    expect(queryInput.ExpressionAttributeValues[":teamId"]).toBe("T123");
    expect(queryInput.ExpressionAttributeValues[":slackUserId"]).toBe("U456");
  });

  it("returns response_type: ephemeral", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("help"))) as Result;
    expect(JSON.parse(result.body).response_type).toBe("ephemeral");
  });

  it("returns ephemeral error when deferred Lambda invoke fails", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    mockLambdaInvoke.mockRejectedValue(new Error("Lambda invoke failed"));
    const result = (await handleSlackEvent(makeSlashPayload("search error scenario"))) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).response_type).toBe("ephemeral");
    expect(JSON.parse(result.body).text).toContain("went wrong");
  });

  it("returns error when response_url is missing", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const payload = makeSlashPayload("search test");
    delete (payload as any).response_url;
    const result = (await handleSlackEvent(payload)) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toContain("response URL");
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("ignores slash commands for commands other than /brain", async () => {
    const result = (await handleSlackEvent({
      type: "slash_command",
      command: "/other",
      text: "search test",
      team_id: "T123",
      user_id: "U456",
    })) as Result;
    expect(result.statusCode).toBe(200);
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });
});

// --- DM messages ---

function makeDmPayload(text: string, eventOverrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T123",
    event: {
      type: "message",
      channel_type: "im",
      channel: "D123",
      user: "U456",
      text,
      ...eventOverrides,
    },
  };
}

describe("handleSlackEvent - DM message", () => {
  it("invokes deferred Lambda with dm_message payload", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    await handleSlackEvent(makeDmPayload("What did I think about AWS?"));
    expect(mockLambdaInvoke).toHaveBeenCalledTimes(1);
    const deferred = getDeferredPayload();
    expect(deferred.type).toBe("dm_message");
    expect(deferred.text).toBe("What did I think about AWS?");
    expect(deferred.userId).toBe("user-abc");
    expect(deferred.accessToken).toBe(INSTALLATION.accessToken);
    expect(deferred.channel).toBe("D123");
  });

  it("ignores bot messages to prevent feedback loops", async () => {
    await handleSlackEvent(makeDmPayload("Bot message", { bot_id: "B123" }));
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("silently ignores DMs when installation not found", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    const result = (await handleSlackEvent(makeDmPayload("Hello"))) as Result;
    expect(result.statusCode).toBe(200);
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("silently ignores DMs from Slack users who haven't linked their brain", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    await handleSlackEvent(makeDmPayload("Hello", { user: "U-stranger" }));
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("ignores DMs with empty text", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    await handleSlackEvent(makeDmPayload(""));
    expect(mockLambdaInvoke).not.toHaveBeenCalled();
  });

  it("returns 200 ok for other event callback types", async () => {
    const result = (await handleSlackEvent({
      type: "event_callback",
      event: { type: "reaction_added", user: "U456" },
    })) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ok).toBe(true);
  });

  it("returns 200 ok for unrecognized payload types", async () => {
    const result = (await handleSlackEvent({ type: "unknown_type" })) as Result;
    expect(result.statusCode).toBe(200);
  });
});
