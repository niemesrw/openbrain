import { describe, it, expect } from "vitest";
import { mcp } from "./helpers/client.js";

describe("MCP protocol", () => {
  it("initialize returns server info and capabilities", async () => {
    const res = await mcp("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as any;
    expect(result.protocolVersion).toBe("2025-03-26");
    expect(result.serverInfo.name).toBe("open-brain");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("ping returns empty result", async () => {
    const res = await mcp("ping");
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({});
  });

  it("tools/list returns all eight tools with correct names", async () => {
    const res = await mcp<{ tools: { name: string }[] }>("tools/list");
    expect(res.error).toBeUndefined();
    const names = res.result!.tools.map((t) => t.name);
    expect(names).toContain("search_thoughts");
    expect(names).toContain("browse_recent");
    expect(names).toContain("stats");
    expect(names).toContain("capture_thought");
    expect(names).toContain("create_agent");
    expect(names).toContain("list_agents");
    expect(names).toContain("revoke_agent");
    expect(names).toContain("bus_activity");
    expect(names).toHaveLength(8);
  });

  it("tools/list includes inputSchema for each tool", async () => {
    const res = await mcp<{ tools: { name: string; inputSchema: unknown }[] }>(
      "tools/list"
    );
    for (const tool of res.result!.tools) {
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
    }
  });

  it("unknown method returns JSON-RPC -32601 error", async () => {
    const res = await mcp("not/a/method");
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });

  it("unknown tool returns -32601 error", async () => {
    const res = await mcp("tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });

  it("notifications/initialized returns 204", async () => {
    // This notification must return 204, not a JSON body
    const config = await import("./helpers/config.js");
    const auth = await import("./helpers/auth.js");
    const apiUrl = (await config.getConfig()).apiUrl;
    const token = await auth.getToken();
    const res = await fetch(`${apiUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(204);
  });
});
