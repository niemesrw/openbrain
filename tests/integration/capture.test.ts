import { describe, it, expect } from "vitest";
import { mcp, toolText } from "./helpers/client.js";

// Tag every thought captured in this test run so tests are distinguishable
// from real data and don't bleed into each other across runs.
const RUN_ID = `ci-test-${Date.now()}`;

describe("capture_thought", () => {
  it("captures a private thought and returns a confirmation", async () => {
    const res = await mcp("tools/call", {
      name: "capture_thought",
      arguments: { text: `${RUN_ID} I prefer TypeScript over JavaScript for large projects.` },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).toMatch(/Captured as/i);
  });

  it("confirmation includes a type from the metadata schema", async () => {
    const res = await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${RUN_ID} Remember to review the Q4 roadmap with the engineering team next Tuesday.`,
      },
    });
    const text = toolText(res as any);
    const validTypes = ["observation", "task", "idea", "reference", "person_note"];
    expect(validTypes.some((t) => text.toLowerCase().includes(t))).toBe(true);
  });

  it("captures a shared thought to the shared index", async () => {
    const res = await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${RUN_ID} Shared architectural decision: use S3 Vectors for all embedding storage.`,
        scope: "shared",
      },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).toMatch(/Captured as/i);
  });

  it("capture with people mentioned includes them in confirmation", async () => {
    const res = await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${RUN_ID} Met with Alice to discuss the new vector search architecture.`,
      },
    });
    const text = toolText(res as any);
    // Metadata extraction should identify Alice as a person
    expect(text).toMatch(/Alice/i);
  });

  it("capture with action items surfaces them in confirmation", async () => {
    const res = await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${RUN_ID} Need to update the CDK stack to add monitoring dashboards by end of sprint.`,
      },
    });
    const text = toolText(res as any);
    expect(text).toMatch(/action items?/i);
  });

  it("missing required text argument returns an error", async () => {
    const res = await mcp("tools/call", {
      name: "capture_thought",
      arguments: {},
    });
    // Either a JSON-RPC error or the tool returns an error string
    const text = toolText(res as any);
    const hasError = res.error || text.toLowerCase().includes("error");
    expect(hasError).toBe(true);
  });
});
