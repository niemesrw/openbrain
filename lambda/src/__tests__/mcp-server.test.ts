/**
 * Smoke tests for MCP server creation and transport wiring.
 * Catches breaking changes in @modelcontextprotocol/sdk and transitive deps (hono).
 */

// Set env vars before any module initializes (verify.ts reads these at load time)
process.env.USER_POOL_ID = "us-east-1_test";
process.env.AGENT_KEYS_TABLE = "test-agent-keys";

jest.mock("../auth/verify");
jest.mock("../tool-executor", () => ({
  executeTool: jest.fn().mockResolvedValue("ok"),
}));
jest.mock("../handlers/insight");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../index";
import type { UserContext } from "../types";

const humanUser: UserContext = { userId: "user-1" };
const agentUser: UserContext = { userId: "user-2", agentName: "test-agent" };

describe("MCP server creation", () => {
  it("returns an McpServer instance", () => {
    const server = createMcpServer(humanUser);
    expect(server).toBeInstanceOf(McpServer);
  });

  it("registers all expected tools for human sessions", () => {
    const spy = jest.spyOn(McpServer.prototype, "registerTool");
    try {
      createMcpServer(humanUser);
      const tools = spy.mock.calls.map((args) => args[0]);

      // Core tools
      expect(tools).toContain("search_thoughts");
      expect(tools).toContain("browse_recent");
      expect(tools).toContain("stats");
      expect(tools).toContain("capture_thought");

      // Human-only admin tools
      expect(tools).toContain("update_thought");
      expect(tools).toContain("delete_thought");
      expect(tools).toContain("create_agent");
      expect(tools).toContain("list_agents");
      expect(tools).toContain("revoke_agent");
      expect(tools).toContain("rotate_agent_key");

      // Shared tools
      expect(tools).toContain("agent_heartbeat");
      expect(tools).toContain("bus_activity");
    } finally {
      spy.mockRestore();
    }
  });

  it("withholds admin and GitHub tools from agent sessions", () => {
    const spy = jest.spyOn(McpServer.prototype, "registerTool");
    try {
      createMcpServer(agentUser);
      const tools = spy.mock.calls.map((args) => args[0]);

      // Agents should have core + shared tools
      expect(tools).toContain("search_thoughts");
      expect(tools).toContain("capture_thought");
      expect(tools).toContain("agent_heartbeat");
      expect(tools).toContain("bus_activity");

      // Agents must NOT have any human-only tools
      expect(tools).not.toContain("update_thought");
      expect(tools).not.toContain("delete_thought");
      expect(tools).not.toContain("create_agent");
      expect(tools).not.toContain("list_agents");
      expect(tools).not.toContain("revoke_agent");
      expect(tools).not.toContain("rotate_agent_key");
      expect(tools).not.toContain("github_label");
      expect(tools).not.toContain("github_comment");
      expect(tools).not.toContain("github_close");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("MCP transport", () => {
  it("WebStandardStreamableHTTPServerTransport can be instantiated", () => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    expect(transport).toBeDefined();
    expect(typeof transport.handleRequest).toBe("function");
  });

  it("server connects to transport without error", async () => {
    const server = createMcpServer(humanUser);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await expect(server.connect(transport)).resolves.not.toThrow();
  });
});
