import { verifyAuth } from "../verify";

jest.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify: jest.fn().mockRejectedValue(new Error("invalid")) })),
  },
}));

jest.mock("../../services/api-key-hmac", () => ({
  hashApiKey: jest.fn().mockResolvedValue("hashed-key"),
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
    QueryCommand: jest.fn((input: unknown) => ({ input })),
    UpdateCommand: jest.fn((input: unknown) => ({ input })),
  };
});

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
const mockSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;

beforeEach(() => {
  mockSend.mockReset();
  process.env.AGENT_KEYS_TABLE = "openbrain-agent-keys";
  process.env.USER_POOL_ID = "us-east-1_test";
});

const API_KEY_HEADERS = { "x-api-key": "ob_deadbeef" };

describe("verifyAuth — API key (hash path)", () => {
  it("authenticates via key-hash-index on the fast path", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ pk: "USER#u1", sk: "AGENT#bot", userId: "u1", agentName: "bot", displayName: "Bot" }],
    });

    const user = await verifyAuth(API_KEY_HEADERS);

    expect(user.userId).toBe("u1");
    expect(user.agentName).toBe("bot");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const query = mockSend.mock.calls[0][0].input;
    expect(query.IndexName).toBe("key-hash-index");
  });

  it("falls back to plaintext lookup when hash misses, then lazy-migrates", async () => {
    // hash miss
    mockSend.mockResolvedValueOnce({ Items: [] });
    // plaintext hit
    mockSend.mockResolvedValueOnce({
      Items: [{ pk: "USER#u2", sk: "AGENT#old", userId: "u2", agentName: "old", displayName: "Old" }],
    });
    // lazy migration update (fire-and-forget)
    mockSend.mockResolvedValueOnce({});

    const user = await verifyAuth(API_KEY_HEADERS);

    expect(user.userId).toBe("u2");
    // Wait a tick for the fire-and-forget UpdateCommand to be issued
    await Promise.resolve();
    expect(mockSend).toHaveBeenCalledTimes(3);
    const updateCall = mockSend.mock.calls[2][0].input;
    expect(updateCall.UpdateExpression).toContain("SET keyHash");
    expect(updateCall.UpdateExpression).toContain("REMOVE apiKey");
  });

  it("throws Unauthorized when both hash and plaintext miss", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }); // hash miss
    mockSend.mockResolvedValueOnce({ Items: [] }); // plaintext miss

    await expect(verifyAuth(API_KEY_HEADERS)).rejects.toThrow("Unauthorized");
  });

  it("throws Unauthorized when no credentials are provided", async () => {
    await expect(verifyAuth({})).rejects.toThrow("Unauthorized");
  });
});
