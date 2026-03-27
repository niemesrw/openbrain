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
  };
});

jest.mock("../../services/github-app", () => ({
  getInstallationDetails: jest.fn().mockResolvedValue({
    accountLogin: "BLANXLAIT",
    accountType: "Organization",
  }),
}));

import {
  handleGitHubConnect,
  handleGitHubDisconnect,
  handleGitHubInstallations,
} from "../github-connect";
import { getInstallationDetails } from "../../services/github-app";

const mockSend = (DynamoDBDocumentClient.from as any).__mockSend as jest.Mock;
const mockGetInstallationDetails = getInstallationDetails as jest.Mock;
const USER = { userId: "user-abc" };

beforeEach(() => {
  mockSend.mockReset();
  mockGetInstallationDetails.mockReset();
  mockGetInstallationDetails.mockResolvedValue({
    accountLogin: "BLANXLAIT",
    accountType: "Organization",
  });
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
});

describe("handleGitHubConnect", () => {
  it("fetches account details from GitHub and stores the installation", async () => {
    mockSend.mockResolvedValue({});
    const result = await handleGitHubConnect({ installationId: "123" }, USER);
    expect(result).toEqual({ ok: true, accountLogin: "BLANXLAIT", accountType: "Organization" });
    expect(mockGetInstallationDetails).toHaveBeenCalledWith("123");
    const item = mockSend.mock.calls[0][0].input.Item;
    expect(item.installationId).toBe("123");
    expect(item.userId).toBe(USER.userId);
    expect(item.accountLogin).toBe("BLANXLAIT");
    expect(item.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uses a conditional write to prevent cross-user overwrites", async () => {
    mockSend.mockResolvedValue({});
    await handleGitHubConnect({ installationId: "456" }, USER);
    const putInput = mockSend.mock.calls[0][0].input;
    expect(putInput.ConditionExpression).toContain("attribute_not_exists(installationId)");
    expect(putInput.ConditionExpression).toContain("userId = :uid");
    expect(putInput.ExpressionAttributeValues[":uid"]).toBe(USER.userId);
  });

  it("throws a 409 when the installation is claimed by another user", async () => {
    const err = Object.assign(new Error("ConditionalCheckFailedException"), {
      name: "ConditionalCheckFailedException",
    });
    mockSend.mockRejectedValue(err);
    await expect(
      handleGitHubConnect({ installationId: "123" }, USER)
    ).rejects.toMatchObject({ message: "Installation already claimed by another user", statusCode: 409 });
  });

  it("re-throws unexpected DynamoDB errors", async () => {
    mockSend.mockRejectedValue(new Error("ProvisionedThroughputExceededException"));
    await expect(
      handleGitHubConnect({ installationId: "123" }, USER)
    ).rejects.toThrow("ProvisionedThroughputExceededException");
  });
});

describe("handleGitHubDisconnect", () => {
  it("successfully deletes the installation when userId matches", async () => {
    mockSend.mockResolvedValue({});
    const result = await handleGitHubDisconnect("123", USER);
    expect(result).toEqual({ ok: true });
    const deleteInput = mockSend.mock.calls[0][0].input;
    expect(deleteInput.Key).toEqual({ installationId: "123" });
    expect(deleteInput.ConditionExpression).toBe("userId = :uid");
    expect(deleteInput.ExpressionAttributeValues[":uid"]).toBe(USER.userId);
  });

  it("throws ConditionalCheckFailedException when userId does not match", async () => {
    const err = Object.assign(new Error("ConditionalCheckFailedException"), {
      name: "ConditionalCheckFailedException",
    });
    mockSend.mockRejectedValue(err);
    await expect(
      handleGitHubDisconnect("123", USER)
    ).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
  });
});

describe("handleGitHubInstallations", () => {
  it("returns an empty list when the user has no installations", async () => {
    mockSend.mockResolvedValue({ Items: [] });
    expect(await handleGitHubInstallations(USER)).toEqual({ installations: [] });
  });

  it("returns the user's installations", async () => {
    mockSend.mockResolvedValue({
      Items: [{ installationId: "123", userId: "user-abc", accountLogin: "BLANXLAIT", accountType: "Organization", installedAt: "2026-03-27T00:00:00.000Z" }],
    });
    const result = await handleGitHubInstallations(USER);
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
