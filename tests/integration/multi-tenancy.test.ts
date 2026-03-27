/**
 * Multi-tenancy enforcement integration tests.
 *
 * Verifies end-to-end that:
 *   1. Private index isolation — user A's private thoughts are invisible to user B
 *   2. Shared index tenant scoping — tenant_id filters work correctly
 *   3. Bus activity tenant filtering — bus_activity respects tenant_id
 *   4. Auth boundaries — unauthenticated and invalid requests are rejected
 *
 * Tests requiring two distinct users are skipped (reported as skipped in CI) when
 * user B credentials are not configured. Set OPENBRAIN_USERNAME_B and
 * OPENBRAIN_PASSWORD_B environment variables, or add username_b/password_b to
 * /openbrain/ci/credentials in Secrets Manager.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mcp, mcpB, toolText, mcpRaw } from "./helpers/client.js";

const RUN_ID = `ci-mt-${Date.now()}`;

// Evaluated at module load time so describe.skipIf works correctly.
const USER_B_CONFIGURED = !!(
  process.env.OPENBRAIN_USERNAME_B && process.env.OPENBRAIN_PASSWORD_B
);

// ---------------------------------------------------------------------------
// Auth boundary tests (no second user needed)
// ---------------------------------------------------------------------------

describe("auth boundaries", () => {
  it("unauthenticated request returns 401", async () => {
    const res = await mcpRaw({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("request with invalid token returns 401", async () => {
    const res = await mcpRaw({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not.a.real.jwt",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("request with syntactically valid but invalid-signed token returns 401", async () => {
    // A syntactically valid JWT payload; signature is intentionally invalid, so this
    // exercises the generic "invalid token" path rather than expiry handling.
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "fake-user", exp: Math.floor(Date.now() / 1000) - 3600 })
    ).toString("base64url");
    const invalidSignedToken = `${header}.${payload}.fakesignature`;

    const res = await mcpRaw({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${invalidSignedToken}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("authenticated request succeeds", async () => {
    const res = await mcp("tools/list");
    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Private index isolation (requires two distinct users)
// ---------------------------------------------------------------------------

describe.skipIf(!USER_B_CONFIGURED)("private index isolation", () => {
  const PRIVATE_MARKER = `${RUN_ID}-private-userA-only`;

  beforeAll(async () => {
    // User A captures a private thought with a unique marker
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${PRIVATE_MARKER} User A private thought that user B must not see.`,
        scope: "private",
      },
    });
  });

  it("user B cannot browse user A's private thoughts", async () => {
    // User B browses their own private index — must not see user A's marker
    const res = await mcpB("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 100 },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).not.toContain(PRIVATE_MARKER);
  });

  it("user B cannot search user A's private thoughts", async () => {
    const res = await mcpB("tools/call", {
      name: "search_thoughts",
      arguments: {
        query: "private thought user A only",
        scope: "private",
        threshold: 0.1,
        limit: 50,
      },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).not.toContain(PRIVATE_MARKER);
  });

  it("user A can still read their own private thought", async () => {
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: { scope: "private", limit: 20 },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    expect(text).toContain(PRIVATE_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Shared index tenant scoping (requires two distinct users)
// ---------------------------------------------------------------------------

describe.skipIf(!USER_B_CONFIGURED)("shared index tenant scoping", () => {
  const SHARED_MARKER_A = `${RUN_ID}-shared-userA`;
  const SHARED_MARKER_B = `${RUN_ID}-shared-userB`;

  beforeAll(async () => {
    // Both users capture shared thoughts
    await Promise.all([
      mcp("tools/call", {
        name: "capture_thought",
        arguments: {
          text: `${SHARED_MARKER_A} User A shared architectural decision.`,
          scope: "shared",
        },
      }),
      mcpB("tools/call", {
        name: "capture_thought",
        arguments: {
          text: `${SHARED_MARKER_B} User B shared architectural decision.`,
          scope: "shared",
        },
      }),
    ]);
  });

  it("both tenants' thoughts appear in shared index without tenant_id filter", async () => {
    // Use search_thoughts for deterministic cross-tenant visibility check.
    // browse_recent is a global feed that can push markers out of the window in
    // active environments — search_thoughts targets the specific content directly.
    const [resA, resB] = await Promise.all([
      mcp("tools/call", {
        name: "search_thoughts",
        arguments: { query: SHARED_MARKER_A, scope: "shared", limit: 5 },
      }),
      mcp("tools/call", {
        name: "search_thoughts",
        arguments: { query: SHARED_MARKER_B, scope: "shared", limit: 5 },
      }),
    ]);
    expect(resA.error).toBeUndefined();
    expect(resB.error).toBeUndefined();
    expect(toolText(resA as any)).toContain(SHARED_MARKER_A);
    expect(toolText(resB as any)).toContain(SHARED_MARKER_B);
  });

  it("browsing shared index with nonexistent tenant_id returns no thoughts for that tenant", async () => {
    // Filter by a tenant_id that no user has — must return nothing.
    // Note: thoughts captured before the multi-tenancy feature (PR #65) have no tenant_id
    // and are always included (backward-compatible). New thoughts captured in this run
    // DO have tenant_id set. We verify the filter works by using a UUID that cannot
    // match any real user's sub.
    const res = await mcp("tools/call", {
      name: "browse_recent",
      arguments: {
        scope: "shared",
        limit: 100,
        tenant_id: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    // Our freshly-captured thoughts (with tenant_id set) must not appear under a different tenant
    expect(text).not.toContain(SHARED_MARKER_A);
    expect(text).not.toContain(SHARED_MARKER_B);
  });

  it("user B can see user A's shared thought (shared index is cross-tenant readable)", async () => {
    const res = await mcpB("tools/call", {
      name: "search_thoughts",
      arguments: { query: SHARED_MARKER_A, scope: "shared", limit: 5 },
    });
    expect(res.error).toBeUndefined();
    expect(toolText(res as any)).toContain(SHARED_MARKER_A);
  });

  it("user A's private thoughts are NOT in the shared index (scope isolation)", async () => {
    // Capture something unique and private as user A
    const PRIVATE_UNIQUE = `${RUN_ID}-private-only-not-in-shared`;
    await mcp("tools/call", {
      name: "capture_thought",
      arguments: {
        text: `${PRIVATE_UNIQUE} This must never appear in the shared index.`,
        scope: "private",
      },
    });

    // User B searches shared index — must not see user A's private thought
    const res = await mcpB("tools/call", {
      name: "search_thoughts",
      arguments: { query: PRIVATE_UNIQUE, scope: "shared", limit: 5 },
    });
    const text = toolText(res as any);
    expect(text).not.toContain(PRIVATE_UNIQUE);
  });
});

// ---------------------------------------------------------------------------
// Bus activity tenant filtering (requires two distinct users)
// ---------------------------------------------------------------------------

describe.skipIf(!USER_B_CONFIGURED)("bus_activity tenant filtering", () => {
  const BUS_MARKER_A = `${RUN_ID}-bus-userA`;
  const BUS_MARKER_B = `${RUN_ID}-bus-userB`;

  beforeAll(async () => {
    // Both users post to the shared bus
    await Promise.all([
      mcp("tools/call", {
        name: "capture_thought",
        arguments: {
          text: `${BUS_MARKER_A} channel:deploys User A deployment notification.`,
          scope: "shared",
        },
      }),
      mcpB("tools/call", {
        name: "capture_thought",
        arguments: {
          text: `${BUS_MARKER_B} channel:deploys User B deployment notification.`,
          scope: "shared",
        },
      }),
    ]);
  });

  it("bus_activity without tenant_id filter returns some activity", async () => {
    // Verify the global feed is reachable and returns data. We avoid asserting that
    // specific markers appear in the truncated global window to prevent flakiness
    // in high-volume environments where other traffic can push markers out of the window.
    const res = await mcp("tools/call", {
      name: "bus_activity",
      arguments: { hours: 1, limit: 100, _format: "json" },
    });
    expect(res.error).toBeUndefined();
    const json = JSON.parse(toolText(res as any));
    const recent = json.recent ?? [];
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.length).toBeGreaterThan(0);
  });

  it("bus_activity with nonexistent tenant_id returns zero results", async () => {
    // New thoughts captured in this run have tenant_id set — a nil UUID cannot
    // match any real user. This confirms the filter path is exercised end-to-end.
    const res = await mcp("tools/call", {
      name: "bus_activity",
      arguments: { hours: 1, limit: 50, tenant_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.error).toBeUndefined();
    const text = toolText(res as any);
    const isEmptyResult =
      text.toLowerCase().includes("no shared activity") ||
      (() => {
        try { return JSON.parse(text).summary?.total === 0; } catch { return false; }
      })();
    expect(isEmptyResult).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// API key boundary — private index derivation from auth token
// ---------------------------------------------------------------------------

describe("private index auth binding", () => {
  it("capture_thought tool schema does not expose user_id or index as caller-controlled params", async () => {
    // The private index name is `private-{userId}`, where userId comes exclusively
    // from the verified auth token (not from the request body). There is no request
    // param that lets a caller specify a different userId. We verify this by
    // confirming the tool schema does not expose a user_id argument.
    const res = await mcp("tools/list");
    expect(res.error).toBeUndefined();

    const tools = (res.result as any)?.tools as Array<{ name: string; inputSchema?: any }> ?? [];
    const captureTool = tools.find((t) => t.name === "capture_thought");
    expect(captureTool).toBeDefined();

    const schema = captureTool?.inputSchema ?? {};
    const properties = schema.properties ?? {};
    expect(properties).not.toHaveProperty("user_id");
    expect(properties).not.toHaveProperty("index");
    expect(properties).not.toHaveProperty("target_user");
  });
});
