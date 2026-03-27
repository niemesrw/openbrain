import { handleTelegramWebhook } from "../telegram-bot";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

jest.mock("@aws-sdk/client-dynamodb", () => {
  const actual = jest.requireActual("@aws-sdk/client-dynamodb");
  const sendMock = jest.fn();
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
    __sendMock: sendMock,
  };
});
jest.mock("@aws-sdk/client-secrets-manager", () => {
  const actual = jest.requireActual("@aws-sdk/client-secrets-manager");
  const sendMock = jest.fn().mockResolvedValue({ SecretString: "bot_token_123" });
  return {
    ...actual,
    SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
    __sendMock: sendMock,
  };
});
jest.mock("../capture-thought");
jest.mock("../search-thoughts");
jest.mock("../browse-recent");
jest.mock("../insight");

import { handleCaptureThought } from "../capture-thought";
import { handleSearchThoughts } from "../search-thoughts";
import { handleBrowseRecent } from "../browse-recent";
import { handleInsight } from "../insight";

const mockCapture = handleCaptureThought as jest.MockedFunction<typeof handleCaptureThought>;
const mockSearch = handleSearchThoughts as jest.MockedFunction<typeof handleSearchThoughts>;
const mockBrowse = handleBrowseRecent as jest.MockedFunction<typeof handleBrowseRecent>;
const mockInsight = handleInsight as jest.MockedFunction<typeof handleInsight>;

const MockDynamoDB = DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>;
const MockSecrets = SecretsManagerClient as jest.MockedClass<typeof SecretsManagerClient>;

// Access module-level send mocks set up in the factory
const ddbSendMock = (jest.requireMock("@aws-sdk/client-dynamodb") as any).__sendMock as jest.Mock;

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const LINKED_USER = { userId: "user-abc", displayName: "Ryan" };
const TELEGRAM_USER_ID = "111222333";

const LINKED_ITEM = {
  Item: {
    telegramUserId: { S: TELEGRAM_USER_ID },
    userId: { S: LINKED_USER.userId },
    displayName: { S: LINKED_USER.displayName },
  },
};

function makeEvent(text: string, fromId = TELEGRAM_USER_ID) {
  return {
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: Number(fromId), first_name: "Ryan" },
        chat: { id: Number(fromId) },
        text,
      },
    }),
    headers: {},
  } as any;
}

beforeEach(() => {
  process.env.TELEGRAM_USERS_TABLE = "openbrain-telegram-users";
  process.env.TELEGRAM_TOKENS_TABLE = "openbrain-telegram-tokens";
  process.env.TELEGRAM_BOT_TOKEN_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:tok";

  MockDynamoDB.mockClear();
  MockSecrets.mockClear();
  (global.fetch as jest.Mock).mockClear();
  ddbSendMock.mockClear();
  ddbSendMock.mockResolvedValue(LINKED_ITEM);

  mockCapture.mockResolvedValue("Captured as observation");
  mockSearch.mockResolvedValue("Found 2 thoughts");
  mockBrowse.mockResolvedValue("Recent thoughts");
  mockInsight.mockResolvedValue({
    headline: "Test insight",
    body: "You have been thinking about X",
    topic: "test",
    count: 3,
    since: Date.now() - 86400000,
  });
});

describe("handleTelegramWebhook", () => {
  it("returns 400 on invalid JSON body", async () => {
    const event = { body: "not-json", headers: {} } as any;
    const result = await handleTelegramWebhook(event);
    expect(result.statusCode).toBe(400);
  });

  it("returns 200 and no action for updates without text", async () => {
    const event = { body: JSON.stringify({ update_id: 1, message: { from: { id: 1 }, chat: { id: 1 } } }), headers: {} } as any;
    const result = await handleTelegramWebhook(event);
    expect(result.statusCode).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("/start replies with welcome when user is linked", async () => {
    const result = await handleTelegramWebhook(makeEvent("/start"));
    expect(result.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sendMessage"),
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain("Welcome back");
  });

  it("/start prompts to link when user is not linked", async () => {
    ddbSendMock.mockResolvedValue({ Item: undefined });
    const result = await handleTelegramWebhook(makeEvent("/start"));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain("Connect Telegram");
  });

  it("/capture calls handleCaptureThought with provided text", async () => {
    const result = await handleTelegramWebhook(makeEvent("/capture my test thought"));
    expect(result.statusCode).toBe(200);
    expect(mockCapture).toHaveBeenCalledWith(
      { text: "my test thought" },
      expect.objectContaining({ userId: LINKED_USER.userId })
    );
  });

  it("/search calls handleSearchThoughts", async () => {
    const result = await handleTelegramWebhook(makeEvent("/search AWS architecture"));
    expect(result.statusCode).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: "AWS architecture", scope: "all", limit: 5 }),
      expect.objectContaining({ userId: LINKED_USER.userId })
    );
  });

  it("/browse calls handleBrowseRecent", async () => {
    const result = await handleTelegramWebhook(makeEvent("/browse"));
    expect(result.statusCode).toBe(200);
    expect(mockBrowse).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "all", limit: 5 }),
      expect.objectContaining({ userId: LINKED_USER.userId })
    );
  });

  it("/insight calls handleInsight and formats response", async () => {
    const result = await handleTelegramWebhook(makeEvent("/insight"));
    expect(result.statusCode).toBe(200);
    expect(mockInsight).toHaveBeenCalledWith(
      expect.objectContaining({ userId: LINKED_USER.userId })
    );
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain("Test insight");
  });

  it("/insight replies with no-insight message when null", async () => {
    mockInsight.mockResolvedValue(null);
    await handleTelegramWebhook(makeEvent("/insight"));
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain("No insight available");
  });

  it("plain text captures as private thought", async () => {
    const result = await handleTelegramWebhook(makeEvent("just a plain thought"));
    expect(result.statusCode).toBe(200);
    expect(mockCapture).toHaveBeenCalledWith(
      { text: "just a plain thought" },
      expect.objectContaining({ userId: LINKED_USER.userId })
    );
  });

  it("prompts to link when unlinked user sends a command", async () => {
    ddbSendMock.mockResolvedValue({ Item: undefined });
    await handleTelegramWebhook(makeEvent("/browse"));
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain("link your account");
  });

  it("unknown command replies with help text", async () => {
    await handleTelegramWebhook(makeEvent("/unknown"));
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain("Unknown command");
  });
});
