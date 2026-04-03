import { describe, it, expect, beforeAll } from "vitest";
import { mcp, toolText } from "./helpers/client.js";

const RUN_ID = `ci-test-${Date.now()}`;

// Seed thoughts before searching — one private, one shared.
// S3 Vectors is strongly consistent on write for the same session, but we
// capture before the describe block to minimise any latency risk.
const PRIVATE_THOUGHT = `${RUN_ID} The team decided to standardise on Bedrock Titan for all embedding workloads.`;
const SHARED_THOUGHT = `${RUN_ID} Shared decision: deploy to us-east-1 as the primary region for Open Brain.`;

beforeAll(async () => {
  await mcp("tools/call", {
    name: "capture_thought",
    arguments: { text: PRIVATE_THOUGHT },
  });
  await mcp("tools/call", {
    name: "capture_thought",
    arguments: { text: SHARED_THOUGHT, scope: "shared" },
  });
});

describe("search_thoughts", () => {
  it("finds a recently captured private thought by semantic query", async () => {
    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "embedding model standardisation",
        scope: "private",
        threshold: 0.3,
      },
    });
    const text = toolText(res as any);
    expect(text).toMatch(new RegExp(RUN_ID));
  });

  it("finds a shared thought when scope is shared", async () => {
    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "primary deployment region",
        scope: "shared",
        threshold: 0.3,
      },
    });
    const text = toolText(res as any);
    expect(text).toMatch(new RegExp(RUN_ID));
  });

  it("scope:all returns results from both indexes", async () => {
    // Query semantically covers both seeded thoughts:
    //   private: "Bedrock Titan for all embedding workloads"
    //   shared:  "deploy to us-east-1 as the primary region"
    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "Bedrock embeddings and primary deployment region",
        scope: "all",
        threshold: 0.1,
        limit: 20,
      },
    });
    const text = toolText(res as any);
    // Both seeded thoughts should appear — one private, one shared
    expect(text).toMatch(/Bedrock Titan/i);
    expect(text).toMatch(/us-east-1/i);
  });

  it("private thought does NOT appear in shared-only search", async () => {
    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "Bedrock Titan embedding workloads",
        scope: "shared",
        threshold: 0.3,
      },
    });
    const text = toolText(res as any);
    // If found, it must be the shared thought, not the private one about Titan
    // (the private thought used "Bedrock Titan"; shared thought used "us-east-1")
    if (text.includes(RUN_ID)) {
      expect(text).not.toMatch(/Bedrock Titan/);
    }
  });

  it("returns no results for an unrelated query", async () => {
    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "recipe for chocolate chip cookies baking temperature",
        scope: "private",
        threshold: 0.9, // very strict
      },
    });
    const text = toolText(res as any);
    expect(text).toMatch(/no matching thoughts/i);
  });

  it("respects the limit parameter", async () => {
    // Capture 3 more thoughts to have enough data
    const promises = Array.from({ length: 3 }, (_, i) =>
      mcp("tools/call", {
        name: "capture_thought",
        arguments: { text: `${RUN_ID} limit-test thought number ${i + 1}` },
      })
    );
    await Promise.all(promises);

    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: { query: `${RUN_ID} limit-test thought`, scope: "private", limit: 2, threshold: 0.1 },
    });
    const text = toolText(res as any);
    const header = text.match(/^Found (\d+) thought/m);
    if (header) {
      expect(Number(header[1])).toBeLessThanOrEqual(2);
    }
  });

  it("type filter restricts results to the requested type", async () => {
    // Capture a clearly task-like thought
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${RUN_ID} TODO: review the open pull requests before the sprint ends.`,
      },
    });

    const res = await mcp("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: `${RUN_ID} review pull requests sprint`,
        type: "task",
        scope: "private",
        threshold: 0.3,
      },
    });
    const text = toolText(res as any);
    if (!text.match(/no matching/i)) {
      expect(text).toMatch(/task/i);
    }
  });
});
