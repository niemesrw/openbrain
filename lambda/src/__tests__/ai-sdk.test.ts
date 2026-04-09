/**
 * Smoke tests for Vercel AI SDK imports and API surface.
 * Catches breaking changes when upgrading the 'ai' or '@ai-sdk/*' packages.
 */

describe("AI SDK exports", () => {
  it("exports streamText and tool from 'ai'", () => {
    // Dynamic require so we test the real module resolution
    const ai = require("ai");
    expect(typeof ai.streamText).toBe("function");
    expect(typeof ai.tool).toBe("function");
  });

  it("tool() accepts a zod schema and returns a tool definition", () => {
    const { tool } = require("ai");
    const { z } = require("zod");

    const t = tool({
      description: "test tool",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }: { query: string }) => `echo: ${query}`,
    });

    expect(t).toBeDefined();
    expect(t.description).toBe("test tool");
  });

  it("exports createAmazonBedrock from '@ai-sdk/amazon-bedrock'", () => {
    const bedrock = require("@ai-sdk/amazon-bedrock");
    expect(typeof bedrock.createAmazonBedrock).toBe("function");
  });
});
