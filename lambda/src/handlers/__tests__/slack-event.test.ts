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

jest.mock("../search-thoughts", () => ({
  handleSearchThoughts: jest.fn().mockResolvedValue("Found 1 thought:\n\nTest thought"),
}));

jest.mock("../capture-thought", () => ({
  handleCaptureThought: jest.fn().mockResolvedValue("Thought captured successfully!"),
}));

import { handleSlackEvent } from "../slack-event";
import { handleSearchThoughts } from "../search-thoughts";
import { handleCaptureThought } from "../capture-thought";

const mockDdbSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;
const mockFetch = jest.fn();
const mockSearch = handleSearchThoughts as jest.Mock;
const mockCapture = handleCaptureThought as jest.Mock;

const INSTALLATION = {
  teamId: "T123",
  userId: "user-abc",
  slackUserId: "U456",
  accessToken: "xoxb-test-token",
  botUserId: "B789",
  teamName: "BLANXLAIT",
};

beforeAll(() => {
  globalThis.fetch = mockFetch;
});

beforeEach(() => {
  mockDdbSend.mockReset();
  mockFetch.mockReset();
  mockSearch.mockReset();
  mockCapture.mockReset();
  mockSearch.mockResolvedValue("Found 1 thought:\n\nTest thought");
  mockCapture.mockResolvedValue("Thought captured successfully!");
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  process.env.SLACK_INSTALLATIONS_TABLE = "openbrain-slack-installations";
});

/** Flush all pending microtasks and macro-tasks so fire-and-forget work completes. */
async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
}

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

describe("handleSlackEvent - slash command", () => {
  it("acks immediately and posts search results to response_url for /brain search <query>", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("search auth decisions"))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Searching");

    await flushPromises();

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "auth decisions", scope: "private" }),
      { userId: "user-abc" }
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/commands/123",
      expect.objectContaining({ method: "POST" })
    );
    const postBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(postBody.text).toContain("Found 1 thought");
  });

  it("acks immediately and posts capture result to response_url for /brain capture <text>", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("capture My great idea"))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Capturing");

    await flushPromises();

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ text: "My great idea", scope: "private" }),
      { userId: "user-abc" }
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/commands/123",
      expect.objectContaining({ method: "POST" })
    );
    const postBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(postBody.text).toContain("captured");
  });

  it("returns help text for /brain help", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("help"))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("search");
    expect(body.text).toContain("capture");
  });

  it("returns help text for /brain with no subcommand", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload(""))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("search");
    expect(body.text).toContain("capture");
  });

  it("treats unrecognized text as a search query", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("what did I decide about auth?"))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Searching");

    await flushPromises();

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "what did I decide about auth?" }),
      expect.any(Object)
    );
  });

  it("returns usage hint when /brain search has no query", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("search"))) as Result;
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Usage");
  });

  it("returns usage hint when /brain capture has no text", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    const result = (await handleSlackEvent(makeSlashPayload("capture"))) as Result;
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Usage");
  });

  it("returns error message when installation not found", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    const result = (await handleSlackEvent(makeSlashPayload("search test"))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Connect at brain.blanxlait.ai");
  });

  it("prompts unlinked Slack users to connect their brain", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] }); // no installation for this Slack user
    const result = (await handleSlackEvent(makeSlashPayload("search test", { user_id: "U-other" }))) as Result;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toContain("Connect at brain.blanxlait.ai");
    expect(mockSearch).not.toHaveBeenCalled();
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
    const body = JSON.parse(result.body);
    expect(body.response_type).toBe("ephemeral");
  });

  it("posts error to response_url and returns 200 when brain search throws", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    mockSearch.mockRejectedValue(new Error("Bedrock timeout"));
    const result = (await handleSlackEvent(makeSlashPayload("search error scenario"))) as Result;
    expect(result.statusCode).toBe(200);

    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/commands/123",
      expect.objectContaining({ method: "POST" })
    );
    const postBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(postBody.text).toContain("something went wrong");
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
  it("searches brain and posts response to DM channel", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });

    await handleSlackEvent(makeDmPayload("What did I think about AWS?"));
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${INSTALLATION.accessToken}` }),
      })
    );
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.channel).toBe("D123");
    expect(callBody.text).toContain("Found 1 thought");
  });

  it("ignores bot messages to prevent feedback loops", async () => {
    await handleSlackEvent(makeDmPayload("Bot message", { bot_id: "B123" }));
    await flushPromises();
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently ignores DMs when installation not found", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    const result = (await handleSlackEvent(makeDmPayload("Hello"))) as Result;
    await flushPromises();
    expect(result.statusCode).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently ignores DMs from Slack users who haven't linked their brain", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] }); // no installation for this user
    await handleSlackEvent(makeDmPayload("Hello", { user: "U-stranger" }));
    await flushPromises();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("captures a thought when DM starts with 'capture:'", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });

    await handleSlackEvent(makeDmPayload("capture: decisions are made with data"));
    await flushPromises();

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ text: "decisions are made with data", scope: "private" }),
      { userId: "user-abc" }
    );
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("captures a thought when DM starts with 'save:'", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });

    await handleSlackEvent(makeDmPayload("save: always test in staging first"));
    await flushPromises();

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ text: "always test in staging first", scope: "private" }),
      { userId: "user-abc" }
    );
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("searches when DM has no capture prefix", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });

    await handleSlackEvent(makeDmPayload("what did I decide about auth?"));
    await flushPromises();

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "what did I decide about auth?" }),
      expect.any(Object)
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("ignores DMs with empty text", async () => {
    mockDdbSend.mockResolvedValue({ Items: [INSTALLATION] });
    await handleSlackEvent(makeDmPayload(""));
    await flushPromises();
    expect(mockFetch).not.toHaveBeenCalled();
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
