import { describe, it, expect } from "vitest";
import { getConfig } from "./helpers/config.js";

describe("health check", () => {
  it("GET /mcp returns ok without auth", async () => {
    const config = await getConfig();
    const res = await fetch(`${config.apiUrl}/mcp`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.name).toBe("open-brain-mcp");
  });
});
