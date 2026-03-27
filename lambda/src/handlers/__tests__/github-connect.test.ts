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
    PutCommand: jest.fn((input: unknown) => ({ input })),
    QueryCommand: jest.fn((input: unknown) => ({ input })),
  };
});

import {
  handleGitHubConnect,
  handleGitHubInstallations,
} from "../github-connect";

const mockSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;
const USER = { userId: "user-abc" };

beforeEach(() => {
  mockSend.mockReset();
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
});

describe("handleGitHubConnect", () => {
  it("stores the installation in DynamoDB and returns { ok: true }", async () => {
    mockSend.mockResolvedValue({});
    const result = await handleGitHubConnect(
      { installationId: "123", accountLogin: "BLANXLAIT", accountType: "Organization" },
      USER
    );
    expect(result).toEqual({ ok: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.installationId).toBe("123");
    expect(item.userId).toBe(USER.userId);
    expect(item.accountLogin).toBe("BLANXLAIT");
    expect(item.accountType).toBe("Organization");
    expect(item.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uses a conditional write to prevent cross-user overwrites", async () => {
    mockSend.mockResolvedValue({});
    await handleGitHubConnect(
      { installationId: "456", accountLogin: "my-org", accountType: "Organization" },
      USER
    );
    const putInput = mockSend.mock.calls[0][0].input;
    expect(putInput.ConditionExpression).toContain("attribute_not_exists(installationId)");
    expect(putInput.ConditionExpression).toContain("userId = :uid");
    expect(putInput.ExpressionAttributeValues[":uid"]).toBe(USER.userId);
  });

  it("throws a 409 error when the installation is claimed by another user", async () => {
    const err = Object.assign(new Error("ConditionalCheckFailedException"), {
      name: "ConditionalCheckFailedException",
    });
    mockSend.mockRejectedValue(err);
    await expect(
      handleGitHubConnect(
        { installationId: "123", accountLogin: "other-org", accountType: "Organization" },
        USER
      )
    ).rejects.toMatchObject({
      message: "Installation already claimed by another user",
      statusCode: 409,
    });
  });

  it("re-throws unexpected DynamoDB errors", async () => {
    const err = new Error("ProvisionedThroughputExceededException");
    mockSend.mockRejectedValue(err);
    await expect(
      handleGitHubConnect(
        { installationId: "123", accountLogin: "org", accountType: "Organization" },
        USER
      )
    ).rejects.toThrow("ProvisionedThroughputExceededException");
  });
});

describe("handleGitHubInstallations", () => {
  it("returns an empty list when the user has no installations", async () => {
    mockSend.mockResolvedValue({ Items: [] });
    const result = await handleGitHubInstallations(USER);
    expect(result).toEqual({ installations: [] });
  });

  it("returns the user's installations", async () => {
    const items = [
      {
        installationId: "123",
        userId: "user-abc",
        accountLogin: "BLANXLAIT",
        accountType: "Organization",
        installedAt: "2026-03-27T00:00:00.000Z",
      },
    ];
    mockSend.mockResolvedValue({ Items: items });
    const result = await handleGitHubInstallations(USER);
    expect(result.installations).toHaveLength(1);
    expect(result.installations[0].accountLogin).toBe("BLANXLAIT");
  });

  it("queries the user-id-index with the correct userId", async () => {
    mockSend.mockResolvedValue({ Items: [] });
    await handleGitHubInstallations(USER);
    const queryInput = mockSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe("user-id-index");
    expect(queryInput.ExpressionAttributeValues[":uid"]).toBe(USER.userId);
  });
});
