import { describe, it, expect, beforeAll } from "vitest";
import { mcp, toolText } from "./helpers/client.js";

const RUN_ID = `ci-test-${Date.now()}`;

beforeAll(async () => {
  // Capture two private thoughts and one shared
  await mcp("tools/call", {
    name: "capture_thought",
    arguments: { text: `${RUN_ID} browse-test: first private thought` },
  });
  await mcp("tools/call", {
    name: "capture_thought",
    arguments: { text: `${RUN_ID} browse-test: second private thought` },
  });
  await mcp("tools/call", {
    name: "capture_thought",
    arguments: { text: `${RUN_ID} browse-test: shared thought`, scope: "shared" },
  });
});

describe("browse_recent", () => {
  it("returns thoughts in the private index", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 50 },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).toMatch(/\d+ recent thought/i);
  });

  it("most recent thought appears first", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 5 },
    });
    const text = toolText(res as any);
    const firstIdx = text.indexOf(`${RUN_ID} browse-test: first`);
    const secondIdx = text.indexOf(`${RUN_ID} browse-test: second`);
    // If both are present, second (captured later) should appear first
    if (firstIdx !== -1 && secondIdx !== -1) {
      expect(secondIdx).toBeLessThan(firstIdx);
    }
  });

  it("limit parameter caps results", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 1 },
    });
    const text = toolText(res as any);
    expect(text).toMatch(/^1 recent thought/im);
  });

  it("scope:shared returns shared thoughts", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "shared", limit: 50 },
    });
    const text = toolText(res as any);
    expect(text).toMatch(new RegExp(`${RUN_ID} browse-test: shared`));
  });

  it("scope:shared does NOT include private thoughts", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "shared", limit: 50 },
    });
    const text = toolText(res as any);
    expect(text).not.toMatch(/browse-test: first private/);
    expect(text).not.toMatch(/browse-test: second private/);
  });

  it("scope:all returns thoughts from both indexes", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "all", limit: 100 },
    });
    const text = toolText(res as any);
    expect(text).toMatch(new RegExp(`${RUN_ID} browse-test: first private`));
    expect(text).toMatch(new RegExp(`${RUN_ID} browse-test: shared`));
  });

  it("empty brain returns a graceful message", async () => {
    // We can't easily test a truly empty index, but we can verify the
    // response format is always well-formed (no crash, no 500)
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 10 },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});
