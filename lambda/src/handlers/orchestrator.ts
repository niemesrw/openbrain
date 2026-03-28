/**
 * Brain-driven issue orchestrator.
 *
 * When a PR merges and closes an issue, searches the shared brain for thoughts
 * that mention dependency on the closed issue. For each unblocked issue found,
 * applies the `claude` label via the GitHub API to trigger the next implementation.
 */

import { getInstallationToken } from "../services/github-app";

/** Parse a PR body for GitHub closing keywords (closes/fixes/resolves #N). */
export function extractClosedIssue(body: string | null | undefined): number | null {
  if (!body) return null;
  const match = body.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return isNaN(num) ? null : num;
}

/** Extract all issue numbers referenced in a block of text. */
function extractIssueNumbers(text: string): number[] {
  const nums: number[] = [];
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    nums.push(parseInt(m[1], 10));
  }
  return nums;
}

/** Call the Open Brain MCP HTTP endpoint with a tools/call request. */
async function callBrainTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const mcpUrl = process.env.OPENBRAIN_MCP_URL;
  const apiKey = process.env.OPENBRAIN_AGENT_API_KEY;
  if (!mcpUrl || !apiKey) {
    throw new Error("OPENBRAIN_MCP_URL or OPENBRAIN_AGENT_API_KEY not configured");
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "1",
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Brain MCP call failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Brain tool error: ${data.error.message}`);
    }

    return data.result?.content?.find((c) => c.type === "text")?.text ?? "";
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new Error("Brain MCP call timed out after 30s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

}

/** Apply the `claude` label to a GitHub issue via the installation token. */
async function labelIssue(
  repo: string,
  issueNumber: number,
  token: string
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ labels: ["claude"] }),
    }
  );

  if (!res.ok) {
    // 422 means label already exists — not an error
    if (res.status !== 422) {
      throw new Error(
        `Failed to label issue #${issueNumber}: ${res.status} ${await res.text()}`
      );
    }
  }
}

/**
 * Main orchestration entry point.
 *
 * @param closedIssueNumber - The issue number closed by the merged PR.
 * @param repo              - The full repository name (e.g. "owner/repo").
 * @param installationId    - GitHub App installation ID for auth.
 */
export async function handleOrchestration(
  closedIssueNumber: number,
  repo: string,
  installationId: string
): Promise<void> {
  // Search the shared brain for dependency thoughts referencing the closed issue
  let searchResult: string;
  try {
    searchResult = await callBrainTool("search_thoughts", {
      query: `depends on #${closedIssueNumber} dependency issue`,
      scope: "shared",
      threshold: 0.3,
      limit: 20,
    });
  } catch (err) {
    console.error("[orchestrator] Brain search failed — skipping orchestration", {
      closedIssueNumber,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!searchResult || searchResult.trim() === "" || searchResult.includes("No thoughts found")) {
    console.log("[orchestrator] No dependency thoughts found for closed issue", { closedIssueNumber });
    return;
  }

  // Extract all issue numbers from the search results, excluding the closed one
  const mentionedIssues = extractIssueNumbers(searchResult);
  const unblockedIssues = [...new Set(mentionedIssues)].filter(
    (n) => n !== closedIssueNumber
  );

  if (unblockedIssues.length === 0) {
    console.log("[orchestrator] No unblocked issues found in dependency thoughts", { closedIssueNumber });
    return;
  }

  console.log("[orchestrator] Unblocked issues to label", { closedIssueNumber, unblockedIssues });

  // Get installation token for GitHub API calls
  let token: string;
  try {
    token = await getInstallationToken(installationId);
  } catch (err) {
    console.error("[orchestrator] Failed to get installation token", {
      installationId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Apply `claude` label to each unblocked issue
  const labeled: number[] = [];
  const failed: number[] = [];
  for (const issueNumber of unblockedIssues) {
    try {
      await labelIssue(repo, issueNumber, token);
      labeled.push(issueNumber);
      console.log("[orchestrator] Labeled issue", { issueNumber, repo });
    } catch (err) {
      failed.push(issueNumber);
      console.error("[orchestrator] Failed to label issue", {
        issueNumber,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (labeled.length === 0) {
    console.log("[orchestrator] No issues were successfully labeled");
    return;
  }

  // Capture coordination log to the shared brain
  const logText =
    `Orchestrator: #${closedIssueNumber} merged in ${repo}. ` +
    `Triggered: ${labeled.map((n) => `#${n}`).join(", ")}` +
    (failed.length > 0 ? `. Failed to label: ${failed.map((n) => `#${n}`).join(", ")}` : "");

  try {
    await callBrainTool("capture_thought", {
      text: logText,
      scope: "shared",
    });
  } catch (err) {
    console.error("[orchestrator] Failed to capture coordination log", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  console.log("[orchestrator] Orchestration complete", { closedIssueNumber, labeled, failed });
}
