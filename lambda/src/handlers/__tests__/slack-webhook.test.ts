import { createHmac } from "crypto";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

jest.mock("@aws-sdk/client-secrets-manager", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    SecretsManagerClient: Client,
    GetSecretValueCommand: jest.fn((input: unknown) => ({ input })),
  };
});

// Mock the slack-event handler so we don't test its internals here
jest.mock("../../handlers/slack-event", () => ({
  handleSlackEvent: jest.fn().mockResolvedValue({ statusCode: 200, body: JSON.stringify({ ok: true }) }),
}));

import { handler, verifySlackSignature } from "../../slack-webhook";

const mockSmSend = (SecretsManagerClient as any).__mockSend as jest.Mock;

const SIGNING_SECRET = "test-signing-secret";

function sign(body: string, timestamp: string, secret = SIGNING_SECRET): string {
  const baseString = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(baseString).digest("hex");
}

function nowS(): string {
  return String(Math.floor(Date.now() / 1000));
}

beforeEach(() => {
  mockSmSend.mockReset();
  mockSmSend.mockResolvedValue({ SecretString: SIGNING_SECRET });
  process.env.SLACK_SIGNING_SECRET_NAME = "openbrain/slack-signing-secret";
  // Reset module-level cache between tests by re-importing won't work easily,
  // but mockSmSend is reset so fresh calls re-fetch the secret.
  // The cache bypass is handled by resetting the module between describe blocks if needed.
});

describe("verifySlackSignature", () => {
  it("returns true for a valid signature", () => {
    const body = '{"type":"event_callback"}';
    const ts = nowS();
    expect(verifySlackSignature(body, ts, sign(body, ts), SIGNING_SECRET)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const body = '{"type":"event_callback"}';
    const ts = nowS();
    expect(verifySlackSignature(body, ts, sign(body, ts, "wrong-secret"), SIGNING_SECRET)).toBe(false);
  });

  it("returns false when timestamp is missing", () => {
    const body = "body";
    const ts = nowS();
    expect(verifySlackSignature(body, undefined, sign(body, ts), SIGNING_SECRET)).toBe(false);
  });

  it("returns false when signature is missing", () => {
    const body = "body";
    const ts = nowS();
    expect(verifySlackSignature(body, ts, undefined, SIGNING_SECRET)).toBe(false);
  });

  it("returns false when timestamp is expired (>5 minutes old)", () => {
    const body = "body";
    const oldTs = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(verifySlackSignature(body, oldTs, sign(body, oldTs), SIGNING_SECRET)).toBe(false);
  });

  it("returns false when signature does not start with v0=", () => {
    const body = "body";
    const ts = nowS();
    const badSig = "sha256=" + createHmac("sha256", SIGNING_SECRET).update(body).digest("hex");
    expect(verifySlackSignature(body, ts, badSig, SIGNING_SECRET)).toBe(false);
  });

  it("returns false when secret is empty", () => {
    const body = "body";
    const ts = nowS();
    expect(verifySlackSignature(body, ts, sign(body, ts), "")).toBe(false);
  });
});

describe("handler", () => {
  type Result = { statusCode: number; body: string };

  function makeEvent(body: string, ts?: string, sig?: string) {
    const timestamp = ts ?? nowS();
    const signature = sig ?? sign(body, timestamp);
    return {
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body,
      isBase64Encoded: false,
    };
  }

  it("returns 401 on invalid signature", async () => {
    const body = '{"type":"event_callback"}';
    const result = await handler(makeEvent(body, nowS(), "v0=badsig") as any) as Result;
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe("Invalid signature");
  });

  it("returns 401 when timestamp is expired", async () => {
    const body = '{"type":"event_callback"}';
    const oldTs = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const result = await handler(makeEvent(body, oldTs, sign(body, oldTs)) as any) as Result;
    expect(result.statusCode).toBe(401);
  });

  it("responds to url_verification challenge", async () => {
    const challenge = "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P";
    const body = JSON.stringify({ type: "url_verification", challenge });
    const result = await handler(makeEvent(body) as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).challenge).toBe(challenge);
  });

  it("returns 200 ok for unknown event types", async () => {
    const body = JSON.stringify({ type: "event_callback", event: { type: "message" } });
    const result = await handler(makeEvent(body) as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ok).toBe(true);
  });

  it("accepts upper-case header variants", async () => {
    const body = JSON.stringify({ type: "event_callback" });
    const ts = nowS();
    const sig = sign(body, ts);
    const event = {
      headers: {
        "X-Slack-Request-Timestamp": ts,
        "X-Slack-Signature": sig,
      },
      body,
      isBase64Encoded: false,
    };
    const result = await handler(event as any) as Result;
    expect(result.statusCode).toBe(200);
  });

  it("decodes base64-encoded bodies before verifying signature", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const ts = nowS();
    const sig = sign(body, ts);
    const event = {
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": sig,
      },
      body: Buffer.from(body).toString("base64"),
      isBase64Encoded: true,
    };
    const result = await handler(event as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).challenge).toBe("abc123");
  });

  it("parses application/x-www-form-urlencoded slash command body and returns 200", async () => {
    const fields = {
      command: "/brain",
      text: "search auth decisions",
      user_id: "U456",
      team_id: "T123",
      response_url: "https://hooks.slack.com/commands/123",
    };
    const body = new URLSearchParams(fields).toString();
    const ts = nowS();
    const sig = sign(body, ts);
    const event = {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-request-timestamp": ts,
        "x-slack-signature": sig,
      },
      body,
      isBase64Encoded: false,
    };

    const { handleSlackEvent } = jest.requireMock("../../handlers/slack-event") as { handleSlackEvent: jest.Mock };
    const result = await handler(event as any) as Result;

    expect(result.statusCode).toBe(200);
    expect(handleSlackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "slash_command" })
    );
  });
});
