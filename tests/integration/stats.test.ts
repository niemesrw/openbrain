import { describe, it, expect, beforeAll } from "vitest";
import { mcp, toolText } from "./helpers/client.js";

const RUN_ID = `ci-test-${Date.now()}`;

let countBefore: number;

beforeAll(async () => {
  // Record count before seeding
  const before = await mcp("tools/call", { name: "stats", arguments: {} });
  const beforeText = toolText(before as any);
  const match = beforeText.match(/Total thoughts:\s*(\d+)/);
  countBefore = match ? Number(match[1]) : 0;

  // Capture one thought so we always have at least something to assert on
  await mcp("tools/call", {
    name: "capture_thought",
    arguments: { text: `${RUN_ID} stats-test: an observation about deployment strategy.` },
  });
});

describe("stats", () => {
  it("returns a well-formed stats response", async () => {
    const res = await mcp("tools/call", { name: "stats", arguments: {} });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).toMatch(/Total thoughts:/i);
    expect(text).toMatch(/By type:/i);
  });

  it("total count increases after a capture", async () => {
    const res = await mcp("tools/call", { name: "stats", arguments: {} });
    const text = toolText(res as any);
    const match = text.match(/Total thoughts:\s*(\d+)/);
    const countAfter = match ? Number(match[1]) : 0;
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  it("lists valid thought types in the breakdown", async () => {
    const res = await mcp("tools/call", { name: "stats", arguments: {} });
    const text = toolText(res as any);
    const validTypes = ["observation", "task", "idea", "reference", "person_note"];
    const foundTypes = validTypes.filter((t) => text.includes(t));
    // At least one type should appear since we captured thoughts
    expect(foundTypes.length).toBeGreaterThan(0);
  });

  it("includes top topics section", async () => {
    const res = await mcp("tools/call", { name: "stats", arguments: {} });
    const text = toolText(res as any);
    expect(text).toMatch(/Top topics:/i);
  });

  it("reports earliest thought date", async () => {
    const res = await mcp("tools/call", { name: "stats", arguments: {} });
    const text = toolText(res as any);
    expect(text).toMatch(/Since:/i);
  });
});
