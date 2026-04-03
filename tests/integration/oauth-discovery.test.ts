import { describe, it, expect } from "vitest";
import { getConfig } from "./helpers/config.js";

describe("OAuth discovery", () => {
  it("GET /.well-known/oauth-protected-resource returns resource metadata", async () => {
    const config = await getConfig();
    const res = await fetch(`${config.apiUrl}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.resource).toContain("/mcp");
    expect(body.authorization_servers).toHaveLength(1);
    expect(body.authorization_servers[0]).toBe(config.apiUrl);
    expect(body.bearer_methods_supported).toContain("header");
    expect(body.scopes_supported).toContain("openid");
  });

  it("GET /.well-known/oauth-authorization-server returns patched Cognito metadata", async () => {
    const config = await getConfig();
    const res = await fetch(`${config.apiUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Must include registration_endpoint for DCR
    expect(body.registration_endpoint).toContain("/register");
    // Must advertise PKCE support
    expect(body.code_challenge_methods_supported).toContain("S256");
    // Authorization and token endpoints should point to our proxy
    expect(body.authorization_endpoint).toContain("/oauth/authorize");
    expect(body.token_endpoint).toContain("/oauth/token");
    // issuer overridden to our baseUrl for RFC 8414 compliance
    expect(body.issuer).toBe(config.apiUrl);
    expect(body.jwks_uri).toBeDefined();
  });

  it("POST /mcp without auth returns 401 with WWW-Authenticate header", async () => {
    const config = await getConfig();
    const res = await fetch(`${config.apiUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate");
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth).toContain("resource_metadata=");
    expect(wwwAuth).toContain("/.well-known/oauth-protected-resource");
  });

  // Gated: creates a real Cognito app client that persists.
  // Set OPENBRAIN_TEST_DCR=true to enable.
  it.skipIf(!process.env.OPENBRAIN_TEST_DCR)("POST /register with valid body returns 201 with client credentials", async () => {
    const config = await getConfig();
    const res = await fetch(`${config.apiUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:19999/callback"],
        client_name: "integration-test-client",
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.client_id).toBeDefined();
    expect(body.client_secret).toBeDefined();
    expect(body.redirect_uris).toEqual(["http://localhost:19999/callback"]);
    expect(body.client_name).toBe("integration-test-client");
    expect(body.grant_types).toContain("authorization_code");
    expect(body.scope).toContain("openid");
  });

  it("POST /register with missing redirect_uris returns 400", async () => {
    const config = await getConfig();
    const res = await fetch(`${config.apiUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "bad-client" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_client_metadata");
  });
});
