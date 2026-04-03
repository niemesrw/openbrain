/**
 * End-to-end tests. Each test captures a unique thought and then immediately
 * searches for it, verifying the full pipeline:
 *   Capture → Bedrock embed → S3 Vectors put → Search → Bedrock embed → S3 Vectors query → result
 */

import { describe, it, expect } from "vitest";
import { mcp, toolText } from "./helpers/client.js";

const RUN_ID = `ci-e2e-${Date.now()}`;

describe("end-to-end", () => {
  it("captures then retrieves a private thought", async () => {
    const unique = `${RUN_ID}-retrieve`;
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: { text: `${unique} The open brain uses cosine similarity for vector search.` },
    });

    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: { query: "cosine similarity vector search", scope: "private", threshold: 0.3 },
    });
    expect(toolText(res as any)).toMatch(new RegExp(unique));
  });

  it("captures then browses for a private thought", async () => {
    const unique = `${RUN_ID}-browse`;
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: { text: `${unique} Browsing test: infrastructure is deployed to us-east-1.` },
    });

    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 10 },
    });
    expect(toolText(res as any)).toMatch(new RegExp(unique));
  });

  it("shared thought captured by one call is searchable by another call", async () => {
    const unique = `${RUN_ID}-shared`;
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${unique} Org-wide: the MCP server runs on Lambda with Cognito JWT auth.`,
        scope: "shared",
      },
    });

    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: { query: "MCP server Lambda Cognito", scope: "shared", threshold: 0.3 },
    });
    expect(toolText(res as any)).toMatch(new RegExp(unique));
  });

  it("private thought is invisible to shared-scope search", async () => {
    const unique = `${RUN_ID}-invisible`;
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${unique} Private: my personal preference is dark mode in VS Code.`,
        scope: "private",
      },
    });

    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "dark mode VS Code preference",
        scope: "shared",
        threshold: 0.1,
      },
    });
    expect(toolText(res as any)).not.toMatch(new RegExp(unique));
  });

  it("stats reflects cumulative captures across the run", async () => {
    const before = await mcp("tools/call", { name: "stats", arguments: {} });
    const beforeCount = Number(
      toolText(before as any).match(/Total thoughts:\s*(\d+)/)?.[1] ?? 0
    );

    await mcp("tools/call", {
      name: "capture_thought",
      arguments: { text: `${RUN_ID}-stats A final e2e capture to verify count increment.` },
    });

    const after = await mcp("tools/call", { name: "stats", arguments: {} });
    const afterCount = Number(
      toolText(after as any).match(/Total thoughts:\s*(\d+)/)?.[1] ?? 0
    );
    expect(afterCount).toBeGreaterThan(beforeCount);
  });
});
