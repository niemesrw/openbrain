jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const send = jest.fn();
  const from = jest.fn(() => ({ send }));
  (from as any).__mockSend = send;
  return {
    DynamoDBDocumentClient: { from },
    QueryCommand: jest.fn((input: unknown) => ({ _tag: "QueryCommand", input })),
    BatchWriteCommand: jest.fn((input: unknown) => ({ _tag: "BatchWriteCommand", input })),
  };
});

const mockS3VectorsSend = jest.fn();
jest.mock("@aws-sdk/client-s3vectors", () => ({
  S3VectorsClient: jest.fn(() => ({ send: mockS3VectorsSend })),
  DeleteIndexCommand: jest.fn((input: unknown) => ({ _tag: "DeleteIndexCommand", input })),
}));

const mockCognitoSend = jest.fn();
jest.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  AdminDeleteUserCommand: jest.fn((input: unknown) => ({ _tag: "AdminDeleteUserCommand", input })),
}));

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { handleDeleteAccount } from "../delete-account";

const mockDdbSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;

// Env vars are read lazily inside the handler functions, so setting them
// before the first call (not at import time) is sufficient.
beforeEach(() => {
  jest.clearAllMocks();
  process.env.VECTOR_BUCKET_NAME = "test-bucket";
  process.env.AGENT_KEYS_TABLE = "openbrain-agent-keys";
  process.env.AGENT_TASKS_TABLE = "openbrain-agent-tasks";
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
  process.env.SLACK_INSTALLATIONS_TABLE = "openbrain-slack-installations";
  process.env.GOOGLE_CONNECTIONS_TABLE = "openbrain-google-connections";
  process.env.USER_POOL_ID = "us-east-1_TestPool";
});

const USER = { userId: "user-123", cognitoUsername: "Google_987654321" };

describe("handleDeleteAccount", () => {
  it("deletes all user data and cognito account", async () => {
    mockS3VectorsSend.mockResolvedValue({});
    // Each table query returns empty to keep the test focused on the flow
    mockDdbSend.mockResolvedValue({ Items: [] });
    mockCognitoSend.mockResolvedValue({});

    await handleDeleteAccount(USER);

    expect(mockS3VectorsSend).toHaveBeenCalledWith(
      expect.objectContaining({ _tag: "DeleteIndexCommand" })
    );
    expect(mockCognitoSend).toHaveBeenCalledWith(
      expect.objectContaining({ _tag: "AdminDeleteUserCommand" })
    );
  });

  it("uses cognitoUsername (not sub) for AdminDeleteUser", async () => {
    mockS3VectorsSend.mockResolvedValue({});
    mockDdbSend.mockResolvedValue({ Items: [] });
    mockCognitoSend.mockResolvedValue({});

    await handleDeleteAccount(USER);

    const cognitoCall = mockCognitoSend.mock.calls[0][0];
    expect(cognitoCall.input.Username).toBe("Google_987654321");
  });

  it("falls back to userId when cognitoUsername is absent", async () => {
    mockS3VectorsSend.mockResolvedValue({});
    mockDdbSend.mockResolvedValue({ Items: [] });
    mockCognitoSend.mockResolvedValue({});

    await handleDeleteAccount({ userId: "user-123" });

    const cognitoCall = mockCognitoSend.mock.calls[0][0];
    expect(cognitoCall.input.Username).toBe("user-123");
  });

  it("batch-deletes agent keys and retries UnprocessedItems", async () => {
    mockS3VectorsSend.mockResolvedValue({});
    mockCognitoSend.mockResolvedValue({});

    const agentKeyItem = { pk: "USER#user-123", sk: "AGENT#claude" };
    let batchAttempt = 0;

    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._tag === "QueryCommand" && cmd.input.TableName === "openbrain-agent-keys") {
        return Promise.resolve({ Items: [agentKeyItem] });
      }
      if (cmd._tag === "BatchWriteCommand") {
        batchAttempt++;
        if (batchAttempt === 1) {
          return Promise.resolve({
            UnprocessedItems: {
              "openbrain-agent-keys": [{ DeleteRequest: { Key: agentKeyItem } }],
            },
          });
        }
        return Promise.resolve({});
      }
      return Promise.resolve({ Items: [] });
    });

    await handleDeleteAccount(USER);

    expect(batchAttempt).toBeGreaterThanOrEqual(2);
  });

  it("throws after 5 failed BatchWriteItem attempts", async () => {
    mockS3VectorsSend.mockResolvedValue({});
    mockCognitoSend.mockResolvedValue({});

    const agentKeyItem = { pk: "USER#user-123", sk: "AGENT#claude" };
    mockDdbSend
      .mockResolvedValueOnce({ Items: [agentKeyItem] }) // query
      .mockResolvedValue({                              // all batch attempts return UnprocessedItems
        UnprocessedItems: { "openbrain-agent-keys": [{ DeleteRequest: { Key: agentKeyItem } }] },
      });

    await expect(handleDeleteAccount(USER)).rejects.toThrow("unprocessed after 5 attempts");
  }, 10_000);

  it("succeeds when private index does not exist", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "NotFoundException" });
    mockS3VectorsSend.mockRejectedValue(notFound);
    mockDdbSend.mockResolvedValue({ Items: [] });
    mockCognitoSend.mockResolvedValue({});

    await expect(handleDeleteAccount(USER)).resolves.toBeUndefined();
  });

  it("re-throws unexpected S3 Vectors errors", async () => {
    const unexpectedErr = Object.assign(new Error("access denied"), { name: "AccessDeniedException" });
    mockS3VectorsSend.mockRejectedValue(unexpectedErr);
    mockDdbSend.mockResolvedValue({ Items: [] });
    mockCognitoSend.mockResolvedValue({});

    await expect(handleDeleteAccount(USER)).rejects.toThrow("access denied");
  });
});
