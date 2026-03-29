import { createHmac } from "crypto";
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
    DeleteCommand: jest.fn((input: unknown) => ({ input })),
    PutCommand: jest.fn((input: unknown) => ({ input })),
    QueryCommand: jest.fn((input: unknown) => ({ input })),
    GetCommand: jest.fn((input: unknown) => ({ input })),
    UpdateCommand: jest.fn((input: unknown) => ({ input })),
  };
});

jest.mock("@aws-sdk/client-secrets-manager", () => {
  const send = jest.fn();
  const SecretsManagerClient = jest.fn(() => ({ send }));
  (SecretsManagerClient as any).__mockSend = send;
  return { SecretsManagerClient, GetSecretValueCommand: jest.fn((input: unknown) => ({ input })) };
});

jest.mock("../capture-thought", () => ({
  handleCaptureThought: jest.fn().mockResolvedValue("captured"),
}));

import {
  handleGoogleConnect,
  handleGoogleCallback,
  handleGoogleConnections,
  handleGoogleDisconnect,
  handleGoogleSync,
  verifyState,
} from "../google-connect";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { handleCaptureThought } from "../capture-thought";

function makeState(userId: string, secret: string, offsetMs = 0): string {
  const timestamp = Date.now() + offsetMs;
  const payload = `${userId}:${timestamp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

const mockDdbSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;
const mockSmSend = (SecretsManagerClient as any).__mockSend as jest.Mock;
const mockFetch = jest.fn();

const USER = { userId: "user-abc" };
const CLIENT_SECRET = "test-client-secret";

beforeAll(() => {
  globalThis.fetch = mockFetch;
});

beforeEach(() => {
  mockDdbSend.mockReset();
  mockSmSend.mockReset();
  mockFetch.mockReset();
  (handleCaptureThought as jest.Mock).mockReset();
  (handleCaptureThought as jest.Mock).mockResolvedValue("captured");
  process.env.GOOGLE_CONNECTIONS_TABLE = "openbrain-google-connections";
  process.env.GOOGLE_CLIENT_ID_SECRET_NAME = "openbrain/google-client-id";
  process.env.GOOGLE_CLIENT_SECRET_SECRET_NAME = "openbrain/google-client-secret";
  mockSmSend.mockResolvedValue({ SecretString: CLIENT_SECRET });
});

describe("handleGoogleConnect", () => {
  it("returns a Google OAuth URL with required parameters", async () => {
    const result = await handleGoogleConnect(USER);
    expect(result.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(result.url).toContain("client_id=");
    expect(result.url).toContain("response_type=code");
    expect(result.url).toContain("access_type=offline");
    expect(result.url).toContain("prompt=consent");
    expect(result.url).toContain("state=");
    expect(result.url).toContain(encodeURIComponent("https://www.googleapis.com/auth/gmail.metadata"));
  });
});

describe("verifyState", () => {
  it("accepts a valid state for the correct user", () => {
    const state = makeState(USER.userId, CLIENT_SECRET);
    expect(() => verifyState(state, USER.userId, CLIENT_SECRET)).not.toThrow();
  });

  it("rejects state for a different user", () => {
    const state = makeState("other-user", CLIENT_SECRET);
    expect(() => verifyState(state, USER.userId, CLIENT_SECRET)).toThrow("State user mismatch");
  });

  it("rejects expired state (>15 minutes old)", () => {
    const state = makeState(USER.userId, CLIENT_SECRET, -(16 * 60 * 1000));
    expect(() => verifyState(state, USER.userId, CLIENT_SECRET)).toThrow("State expired or invalid");
  });

  it("rejects tampered signature", () => {
    const state = makeState(USER.userId, CLIENT_SECRET);
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const tampered = Buffer.from(decoded.slice(0, -4) + "aaaa").toString("base64url");
    expect(() => verifyState(tampered, USER.userId, CLIENT_SECRET)).toThrow("State signature invalid");
  });

  it("rejects state signed with a different secret", () => {
    const state = makeState(USER.userId, "wrong-secret");
    expect(() => verifyState(state, USER.userId, CLIENT_SECRET)).toThrow("State signature invalid");
  });
});

describe("handleGoogleCallback", () => {
  const tokenSuccess = {
    access_token: "ya29.access",
    refresh_token: "1//refresh",
    token_type: "Bearer",
    expires_in: 3600,
  };
  const userInfoSuccess = { email: "alice@example.com" };

  function mockTokenAndUserInfo(
    tokenResp: unknown = tokenSuccess,
    userInfoResp: unknown = userInfoSuccess
  ) {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => tokenResp })
      .mockResolvedValueOnce({ ok: true, json: async () => userInfoResp });
  }

  it("exchanges code, fetches userinfo, stores connection in DynamoDB", async () => {
    mockTokenAndUserInfo();
    mockDdbSend.mockResolvedValue({});

    const state = makeState(USER.userId, CLIENT_SECRET);
    const result = await handleGoogleCallback("auth-code", state, USER);

    expect(result).toEqual({ ok: true, email: "alice@example.com" });
    const putInput = mockDdbSend.mock.calls[0][0].input;
    expect(putInput.Item.userId).toBe(USER.userId);
    expect(putInput.Item.email).toBe("alice@example.com");
    expect(putInput.Item.refreshToken).toBe("1//refresh");
    expect(putInput.Item.accessToken).toBe("ya29.access");
    expect(putInput.Item.connectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects an invalid state before calling Google APIs", async () => {
    await expect(
      handleGoogleCallback("auth-code", "invalid-state", USER)
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a state for a different user", async () => {
    const state = makeState("other-user", CLIENT_SECRET);
    await expect(
      handleGoogleCallback("auth-code", state, USER)
    ).rejects.toThrow("State user mismatch");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when Google token exchange returns an error", async () => {
    const state = makeState(USER.userId, CLIENT_SECRET);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: "invalid_grant", error_description: "Token has been expired" }),
    });
    await expect(handleGoogleCallback("bad-code", state, USER)).rejects.toThrow(
      "Token has been expired"
    );
  });

  it("throws when token exchange returns non-2xx HTTP", async () => {
    const state = makeState(USER.userId, CLIENT_SECRET);
    mockFetch.mockResolvedValue({ ok: false, status: 400 });
    await expect(handleGoogleCallback("code", state, USER)).rejects.toThrow(
      "Google token exchange HTTP error: 400"
    );
  });

  it("throws when refresh_token is missing (offline_access not set)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "ya29.access" }), // no refresh_token
    });
    const state = makeState(USER.userId, CLIENT_SECRET);
    await expect(handleGoogleCallback("code", state, USER)).rejects.toThrow(
      "missing refresh_token"
    );
  });

  it("throws when userinfo response is missing email", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => tokenSuccess })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // no email
    const state = makeState(USER.userId, CLIENT_SECRET);
    await expect(handleGoogleCallback("code", state, USER)).rejects.toThrow(
      "missing email"
    );
  });
});

describe("handleGoogleConnections", () => {
  it("returns an empty list when the user has no connections", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    expect(await handleGoogleConnections(USER)).toEqual({ connections: [] });
  });

  it("returns the user's Google connections", async () => {
    mockDdbSend.mockResolvedValue({
      Items: [
        {
          userId: "user-abc",
          email: "alice@example.com",
          connectedAt: "2026-03-29T00:00:00.000Z",
        },
      ],
    });
    const result = await handleGoogleConnections(USER);
    expect(result.connections[0].email).toBe("alice@example.com");
    expect(result.connections[0].userId).toBe("user-abc");
  });

  it("queries with the correct userId", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });
    await handleGoogleConnections(USER);
    const queryInput = mockDdbSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[":uid"]).toBe(USER.userId);
  });
});

describe("handleGoogleDisconnect", () => {
  it("deletes using the composite key (userId + email)", async () => {
    mockDdbSend.mockResolvedValue({});
    const result = await handleGoogleDisconnect("alice@example.com", USER);
    expect(result).toEqual({ ok: true });
    const deleteInput = mockDdbSend.mock.calls[0][0].input;
    expect(deleteInput.Key).toEqual({ userId: USER.userId, email: "alice@example.com" });
  });

  it("is idempotent — succeeds when the connection does not exist", async () => {
    mockDdbSend.mockResolvedValue({});
    await expect(handleGoogleDisconnect("nonexistent@example.com", USER)).resolves.toEqual({ ok: true });
  });
});

describe("handleGoogleSync", () => {
  beforeEach(() => {
    // Make setTimeout a no-op so capture throttle doesn't slow tests
    jest.spyOn(global, "setTimeout").mockImplementation((fn: Parameters<typeof setTimeout>[0]) => {
      if (typeof fn === "function") fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const connection = {
    userId: "user-abc",
    email: "alice@example.com",
    refreshToken: "1//refresh",
    accessToken: "ya29.valid",
    accessTokenExpiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
  };

  const messageList = {
    messages: [
      { id: "msg1", threadId: "thread1" },
      { id: "msg2", threadId: "thread2" },
    ],
  };

  const messageMetadata = (id: string) => ({
    id,
    threadId: `thread-${id}`,
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      headers: [
        { name: "From", value: "sender@example.com" },
        { name: "To", value: "alice@example.com" },
        { name: "Subject", value: `Test subject ${id}` },
        { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
      ],
    },
  });

  it("fetches messages, captures each as a thought, returns counts", async () => {
    // GetCommand (load connection with valid token, no prior historyId)
    mockDdbSend
      .mockResolvedValueOnce({ Item: connection }) // GetCommand
      .mockResolvedValueOnce({});                  // UpdateCommand (persist historyId)

    // Gmail list → profile (historyId cursor) → 2 message metadata fetches
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => messageList })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => messageMetadata("msg1") })
      .mockResolvedValueOnce({ ok: true, json: async () => messageMetadata("msg2") });

    const result = await handleGoogleSync("alice@example.com", USER);

    expect(result).toEqual({ ok: true, email: "alice@example.com", captured: 2, skipped: 0 });
    expect(handleCaptureThought).toHaveBeenCalledTimes(2);
    const firstCall = (handleCaptureThought as jest.Mock).mock.calls[0];
    expect(firstCall[0].text).toContain("Test subject msg1");
    expect(firstCall[0].scope).toBe("private");
  });

  it("counts failed message fetches as skipped", async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});  // UpdateCommand (persist historyId)

    // Gmail list → profile (historyId cursor) → msg1 (fails) → msg2
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => messageList })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: false, status: 403 }) // msg1 fails
      .mockResolvedValueOnce({ ok: true, json: async () => messageMetadata("msg2") });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("returns zero counts when there are no messages", async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});  // UpdateCommand (persist historyId)
    // Gmail list → profile (no messages, so no further fetches)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result).toEqual({ ok: true, email: "alice@example.com", captured: 0, skipped: 0 });
    expect(handleCaptureThought).not.toHaveBeenCalled();
  });

  it("throws when no connection exists for the email", async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });
    await expect(handleGoogleSync("unknown@example.com", USER)).rejects.toThrow(
      "No Google connection found for unknown@example.com"
    );
  });

  it("refreshes access token when it is expiring soon", async () => {
    const expiredConnection = {
      ...connection,
      accessTokenExpiry: new Date(Date.now() - 1000).toISOString(), // already expired
    };
    mockDdbSend
      .mockResolvedValueOnce({ Item: expiredConnection }) // GetCommand
      .mockResolvedValueOnce({})                          // UpdateCommand (persist refreshed token)
      .mockResolvedValueOnce({});                         // UpdateCommand (persist historyId)

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "ya29.new", expires_in: 3600 }) }) // token refresh
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }) })                              // gmail list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) });                         // profile (historyId cursor)

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.ok).toBe(true);
    // Token refresh endpoint should have been called
    const refreshCall = mockFetch.mock.calls[0];
    expect(refreshCall[0]).toContain("oauth2.googleapis.com/token");
  });

  it("captures CATEGORY_UPDATES emails (hotel confirmations, receipts, etc.)", async () => {
    const hotelConfirmation = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX", "CATEGORY_UPDATES"],
      payload: {
        headers: [
          { name: "From", value: "info@hilton.com" },
          { name: "To", value: "alice@example.com" },
          { name: "Subject", value: "Hilton Orlando Reservation Confirmation" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => hotelConfirmation });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skips large-group emails that are not transactional", async () => {
    const largeGroupMetadata = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX"],
      payload: {
        headers: [
          { name: "From", value: "boss@company.com" },
          { name: "To", value: "a@x.com, b@x.com, c@x.com, d@x.com, e@x.com, f@x.com, g@x.com" },
          { name: "Subject", value: "Company all-hands update" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => largeGroupMetadata });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(0);
    expect(result.skipped).toBe(1);
    expect(handleCaptureThought).not.toHaveBeenCalled();
  });

  it("captures large-group emails when subject is transactional", async () => {
    const transactionalMetadata = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX"],
      payload: {
        headers: [
          { name: "From", value: "noreply@airline.com" },
          { name: "To", value: "a@x.com, b@x.com, c@x.com, d@x.com, e@x.com, f@x.com, g@x.com" },
          { name: "Subject", value: "Your flight confirmation" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => transactionalMetadata });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("skips messages with noise category labels (promotions/social/forums)", async () => {
    const promotionalMetadata = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
      payload: {
        headers: [
          { name: "From", value: "deals@shop.com" },
          { name: "To", value: "alice@example.com" },
          { name: "Subject", value: "50% off sale!" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => promotionalMetadata });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(0);
    expect(result.skipped).toBe(1);
    expect(handleCaptureThought).not.toHaveBeenCalled();
  });

  it("skips CATEGORY_UPDATES emails that are not transactional (automated alerts)", async () => {
    const alertMetadata = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX", "CATEGORY_UPDATES"],
      payload: {
        headers: [
          { name: "From", value: "alerts@github.com" },
          { name: "To", value: "alice@example.com" },
          { name: "Subject", value: "New comment on your pull request" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => alertMetadata });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(0);
    expect(result.skipped).toBe(1);
    expect(handleCaptureThought).not.toHaveBeenCalled();
  });

  it("skips emails from automated senders (no-reply, notifications@, etc.)", async () => {
    const ghNotification = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX"],
      payload: {
        headers: [
          { name: "From", value: "notifications@github.com" },
          { name: "To", value: "alice@example.com" },
          { name: "Subject", value: "ryan merged your pull request" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ghNotification });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(0);
    expect(result.skipped).toBe(1);
    expect(handleCaptureThought).not.toHaveBeenCalled();
  });

  it("captures emails from automated senders when subject is transactional", async () => {
    const receiptMetadata = {
      id: "msg1",
      threadId: "thread1",
      labelIds: ["INBOX"],
      payload: {
        headers: [
          { name: "From", value: "noreply@amazon.com" },
          { name: "To", value: "alice@example.com" },
          { name: "Subject", value: "Your order has been placed" },
          { name: "Date", value: "Mon, 29 Mar 2026 10:00:00 +0000" },
        ],
      },
    };

    mockDdbSend
      .mockResolvedValueOnce({ Item: connection })
      .mockResolvedValueOnce({});

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "msg1", threadId: "thread1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ historyId: "999" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => receiptMetadata });

    const result = await handleGoogleSync("alice@example.com", USER);
    expect(result.captured).toBe(1);
    expect(result.skipped).toBe(0);
  });
});
