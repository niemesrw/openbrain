import { extractClosedIssue, handleOrchestration } from "../orchestrator";

// Mock github-app service
jest.mock("../../services/github-app", () => ({
  getInstallationToken: jest.fn(),
}));

import { getInstallationToken } from "../../services/github-app";

const mockGetInstallationToken = getInstallationToken as jest.Mock;

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.OPENBRAIN_MCP_URL = "https://brain.example.com/mcp";
  process.env.OPENBRAIN_AGENT_API_KEY = "test-agent-key";
});

// ---------------------------------------------------------------------------
// extractClosedIssue
// ---------------------------------------------------------------------------

describe("extractClosedIssue", () => {
  it("parses 'closes #N'", () => {
    expect(extractClosedIssue("This PR closes #42")).toBe(42);
  });

  it("parses 'fixes #N' (case-insensitive)", () => {
    expect(extractClosedIssue("Fixes #100")).toBe(100);
  });

  it("parses 'resolves #N'", () => {
    expect(extractClosedIssue("resolves #7")).toBe(7);
  });

  it("handles uppercase CLOSES", () => {
    expect(extractClosedIssue("CLOSES #55")).toBe(55);
  });

  it("returns null when no closing keyword present", () => {
    expect(extractClosedIssue("Just a PR description")).toBeNull();
  });

  it("returns null for null body", () => {
    expect(extractClosedIssue(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractClosedIssue("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(extractClosedIssue(undefined)).toBeNull();
  });

  it("parses multiline PR bodies", () => {
    const body = "## Summary\n\nThis fixes a bug.\n\nCloses #23\n\nSome more text.";
    expect(extractClosedIssue(body)).toBe(23);
  });
});

// ---------------------------------------------------------------------------
// handleOrchestration
// ---------------------------------------------------------------------------

function makeMcpResponse(text: string) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        result: { content: [{ type: "text", text }] },
      }),
    text: () => Promise.resolve(""),
    status: 200,
  };
}

function makeGitHubLabelResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(""),
  };
}

describe("handleOrchestration", () => {
  const INSTALLATION_ID = "12345";
  const REPO = "owner/repo";
  const CLOSED_ISSUE = 87;
  const TOKEN = "ghs_test_token";

  it("labels unblocked issues found in brain dependency thoughts", async () => {
    mockGetInstallationToken.mockResolvedValue(TOKEN);

    // First fetch call: brain search_thoughts
    // Second fetch call: label issue #92
    mockFetch
      .mockResolvedValueOnce(
        makeMcpResponse("Found thoughts:\n\n#92 depends on #87 — Slack integration\n#91 also depends on #87")
      )
      .mockResolvedValueOnce(makeGitHubLabelResponse(200)) // label #92
      .mockResolvedValueOnce(makeGitHubLabelResponse(200)) // label #91
      .mockResolvedValueOnce(makeMcpResponse("Captured")); // capture_thought

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    expect(mockGetInstallationToken).toHaveBeenCalledWith(INSTALLATION_ID);

    // Brain search call
    const searchCall = mockFetch.mock.calls[0];
    const searchBody = JSON.parse(searchCall[1].body);
    expect(searchBody.method).toBe("tools/call");
    expect(searchBody.params.name).toBe("search_thoughts");
    expect(searchBody.params.arguments.scope).toBe("shared");
    expect(searchBody.params.arguments.query).toContain("87");

    // GitHub label calls
    const labelCall1 = mockFetch.mock.calls[1];
    expect(labelCall1[0]).toContain("/issues/");
    expect(labelCall1[0]).toContain("/labels");
    const labelBody1 = JSON.parse(labelCall1[1].body);
    expect(labelBody1.labels).toContain("claude");

    // Capture log call
    const captureCall = mockFetch.mock.calls[3];
    const captureBody = JSON.parse(captureCall[1].body);
    expect(captureBody.params.name).toBe("capture_thought");
    expect(captureBody.params.arguments.text).toContain("#87");
    expect(captureBody.params.arguments.text).toContain("Triggered");
  });

  it("no-ops when brain search returns no results", async () => {
    mockFetch.mockResolvedValueOnce(makeMcpResponse("No thoughts found"));

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    expect(mockGetInstallationToken).not.toHaveBeenCalled();
    // Only the search call — no label or capture
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("no-ops when brain search returns only the closed issue number", async () => {
    mockFetch.mockResolvedValueOnce(
      makeMcpResponse("The closed PR merged issue #87")
    );

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    expect(mockGetInstallationToken).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips orchestration gracefully when brain search fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve("Service Unavailable"),
    });

    await expect(
      handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID)
    ).resolves.toBeUndefined();

    expect(mockGetInstallationToken).not.toHaveBeenCalled();
  });

  it("skips labeling gracefully when installation token fetch fails", async () => {
    mockFetch.mockResolvedValueOnce(
      makeMcpResponse("Issue #92 depends on #87")
    );
    mockGetInstallationToken.mockRejectedValue(new Error("Token error"));

    await expect(
      handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID)
    ).resolves.toBeUndefined();

    // Should not attempt to label or capture
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("continues labeling remaining issues if one label call fails", async () => {
    mockGetInstallationToken.mockResolvedValue(TOKEN);

    mockFetch
      .mockResolvedValueOnce(
        makeMcpResponse("Issue #92 depends on #87. Issue #93 also depends on #87.")
      )
      .mockResolvedValueOnce(makeGitHubLabelResponse(500)) // label #92 fails
      .mockResolvedValueOnce(makeGitHubLabelResponse(200)) // label #93 succeeds
      .mockResolvedValueOnce(makeMcpResponse("Captured")); // capture_thought

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    // Capture should include the successful one
    const captureBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(captureBody.params.arguments.text).toContain("Triggered");
    expect(captureBody.params.arguments.text).toContain("Failed");
  });

  it("does not capture log when all label calls fail", async () => {
    mockGetInstallationToken.mockResolvedValue(TOKEN);

    mockFetch
      .mockResolvedValueOnce(
        makeMcpResponse("Issue #92 depends on #87")
      )
      .mockResolvedValueOnce(makeGitHubLabelResponse(500)); // label fails

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    // No capture call after failed labeling
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("treats 422 (label already exists) as success", async () => {
    mockGetInstallationToken.mockResolvedValue(TOKEN);

    mockFetch
      .mockResolvedValueOnce(
        makeMcpResponse("Issue #92 depends on #87")
      )
      .mockResolvedValueOnce(makeGitHubLabelResponse(422)) // already labeled
      .mockResolvedValueOnce(makeMcpResponse("Captured")); // capture_thought

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    // Should have labeled (422 treated as success) and captured
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const captureBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(captureBody.params.arguments.text).toContain("#92");
  });

  it("uses Authorization Bearer header with agent API key for brain calls", async () => {
    mockFetch.mockResolvedValueOnce(makeMcpResponse("No thoughts found"));

    await handleOrchestration(CLOSED_ISSUE, REPO, INSTALLATION_ID);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer test-agent-key");
  });
});
