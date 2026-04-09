import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({})),
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

jest.mock("../../services/github-app", () => ({
  getInstallationToken: jest.fn(),
}));

import {
  handleGitHubLabel,
  handleGitHubComment,
  handleGitHubClose,
} from "../github-actions";
import { getInstallationToken } from "../../services/github-app";

const mockDdbSend = (DynamoDBDocumentClient as any).from.__mockSend as jest.Mock;
const mockGetToken = getInstallationToken as jest.Mock;

const user = { userId: "user-123" };

const installation = {
  installationId: "inst-1",
  userId: "user-123",
  accountLogin: "myorg",
  accountType: "Organization" as const,
  installedAt: "2024-01-01T00:00:00Z",
};

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  }) as any;
}

beforeEach(() => {
  mockDdbSend.mockReset();
  mockGetToken.mockReset();
  mockGetToken.mockResolvedValue("gh-token-abc");
  process.env.GITHUB_INSTALLATIONS_TABLE = "openbrain-github-installations";
});

afterEach(() => {
  delete process.env.GITHUB_INSTALLATIONS_TABLE;
});

// --- github_label ---

describe("handleGitHubLabel", () => {
  it("returns error when no installation found for owner", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });

    const result = await handleGitHubLabel(
      { owner: "unknown-org", repo: "myrepo", issue_number: 1, labels: ["bug"] },
      user
    );
    expect(result).toContain('No GitHub installation found for owner "unknown-org"');
  });

  it("matches owner case-insensitively", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(200, [{ name: "bug" }]);

    const result = await handleGitHubLabel(
      { owner: "MyOrg", repo: "myrepo", issue_number: 1, labels: ["bug"] },
      user
    );
    expect(result).toContain("Added labels on MyOrg/myrepo#1");
  });

  it("picks the newest installation when duplicates exist", async () => {
    const older = { ...installation, installationId: "inst-old", installedAt: "2023-01-01T00:00:00Z" };
    const newer = { ...installation, installationId: "inst-new", installedAt: "2025-06-01T00:00:00Z" };
    mockDdbSend.mockResolvedValue({ Items: [older, newer] });
    mockFetch(200, [{ name: "bug" }]);

    await handleGitHubLabel(
      { owner: "myorg", repo: "myrepo", issue_number: 1, labels: ["bug"] },
      user
    );
    expect(mockGetToken).toHaveBeenCalledWith("inst-new");
  });

  it("adds labels (POST) when action is add", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(200, [{ name: "bug" }]);

    const result = await handleGitHubLabel(
      { owner: "myorg", repo: "myrepo", issue_number: 42, labels: ["bug", "enhancement"] },
      user
    );
    expect(result).toContain("Added labels on myorg/myrepo#42");
    expect(result).toContain("bug");

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toContain("/issues/42/labels");
    expect(fetchCall[1].method).toBe("POST");
  });

  it("sets labels (PUT) when action is set", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(200, [{ name: "triage" }]);

    const result = await handleGitHubLabel(
      { owner: "myorg", repo: "myrepo", issue_number: 5, labels: ["triage"], action: "set" },
      user
    );
    expect(result).toContain("Set labels on myorg/myrepo#5");

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[1].method).toBe("PUT");
  });

  it("removes labels (DELETE per label) when action is remove", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue("") })
      .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue("") }) as any;

    const result = await handleGitHubLabel(
      { owner: "myorg", repo: "myrepo", issue_number: 7, labels: ["bug", "wip"], action: "remove" },
      user
    );
    expect(result).toContain("Removed labels from myorg/myrepo#7");
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("returns error message on GitHub API failure", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(422, "Validation Failed");

    const result = await handleGitHubLabel(
      { owner: "myorg", repo: "myrepo", issue_number: 1, labels: ["invalid"] },
      user
    );
    expect(result).toContain("GitHub API error 422");
  });

  it("reports partial failure when removing labels", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: jest.fn().mockResolvedValue("Not Found") })
      .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue("") }) as any;

    const result = await handleGitHubLabel(
      { owner: "myorg", repo: "myrepo", issue_number: 3, labels: ["missing", "bug"], action: "remove" },
      user
    );
    expect(result).toContain("Failed to remove label(s)");
    expect(result).toContain('"missing" (404: Not Found)');
  });
});

// --- github_comment ---

describe("handleGitHubComment", () => {
  it("returns error when no installation found", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });

    const result = await handleGitHubComment(
      { owner: "unknown", repo: "repo", issue_number: 1, body: "hello" },
      user
    );
    expect(result).toContain('No GitHub installation found for owner "unknown"');
  });

  it("posts a comment and returns the URL", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(201, { html_url: "https://github.com/myorg/myrepo/issues/10#issuecomment-999" });

    const result = await handleGitHubComment(
      { owner: "myorg", repo: "myrepo", issue_number: 10, body: "LGTM!" },
      user
    );
    expect(result).toContain("Comment posted on myorg/myrepo#10");
    expect(result).toContain("https://github.com/myorg/myrepo/issues/10#issuecomment-999");

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toContain("/issues/10/comments");
    expect(fetchCall[1].method).toBe("POST");
    expect(JSON.parse(fetchCall[1].body)).toEqual({ body: "LGTM!" });
  });

  it("returns error message on GitHub API failure", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(403, "Forbidden");

    const result = await handleGitHubComment(
      { owner: "myorg", repo: "myrepo", issue_number: 1, body: "test" },
      user
    );
    expect(result).toContain("GitHub API error 403");
  });

  it("uses the installation token in the Authorization header", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockGetToken.mockResolvedValue("test-token-xyz");
    mockFetch(201, { html_url: "https://github.com/myorg/myrepo/issues/1#issuecomment-1" });

    await handleGitHubComment(
      { owner: "myorg", repo: "myrepo", issue_number: 1, body: "hi" },
      user
    );
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer test-token-xyz");
  });
});

// --- github_close ---

describe("handleGitHubClose", () => {
  it("returns error when no installation found", async () => {
    mockDdbSend.mockResolvedValue({ Items: [] });

    const result = await handleGitHubClose(
      { owner: "unknown", repo: "repo", issue_number: 1 },
      user
    );
    expect(result).toContain('No GitHub installation found for owner "unknown"');
  });

  it("closes an issue with default state_reason (completed)", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(200, { state: "closed", html_url: "https://github.com/myorg/myrepo/issues/15" });

    const result = await handleGitHubClose(
      { owner: "myorg", repo: "myrepo", issue_number: 15 },
      user
    );
    expect(result).toContain("Closed myorg/myrepo#15");
    expect(result).toContain("completed");

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[1].method).toBe("PATCH");
    expect(JSON.parse(fetchCall[1].body)).toEqual({ state: "closed", state_reason: "completed" });
  });

  it("closes an issue with not_planned state_reason", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(200, { state: "closed" });

    const result = await handleGitHubClose(
      { owner: "myorg", repo: "myrepo", issue_number: 20, state_reason: "not_planned" },
      user
    );
    expect(result).toContain("not_planned");

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(fetchCall[1].body).state_reason).toBe("not_planned");
  });

  it("returns error message on GitHub API failure", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(404, "Not Found");

    const result = await handleGitHubClose(
      { owner: "myorg", repo: "myrepo", issue_number: 999 },
      user
    );
    expect(result).toContain("GitHub API error 404");
  });

  it("sends correct URL for the issue endpoint", async () => {
    mockDdbSend.mockResolvedValue({ Items: [installation] });
    mockFetch(200, { state: "closed" });

    await handleGitHubClose(
      { owner: "myorg", repo: "myrepo", issue_number: 7 },
      user
    );
    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.github.com/repos/myorg/myrepo/issues/7");
  });
});
