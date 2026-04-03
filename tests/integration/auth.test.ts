import { describe, it, expect } from "vitest";
import { getConfig } from "./helpers/config.js";
import { mcpRaw } from "./helpers/client.js";

describe("authentication", () => {
  it("POST without Authorization header returns 401", async () => {
    const res = await mcpRaw({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST with a malformed token returns 401", async () => {
    const res = await mcpRaw({
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer this.is.not.a.valid.jwt",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST with a valid token returns 200", async () => {
    // Piggyback on tools/list — if auth works, we get a real response
    const config = await getConfig();
    const { CognitoIdentityProviderClient, InitiateAuthCommand } = await import(
      "@aws-sdk/client-cognito-identity-provider"
    );
    const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });
    const res = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: config.clientId,
        AuthParameters: {
          USERNAME: config.username,
          PASSWORD: config.password,
        },
      })
    );
    const token = res.AuthenticationResult!.AccessToken!;
    const httpRes = await mcpRaw({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(httpRes.status).toBe(200);
  });
});
