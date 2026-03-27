import { createHmac } from "crypto";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

jest.mock("@aws-sdk/client-sqs", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    SQSClient: Client,
    SendMessageCommand: jest.fn((input: unknown) => ({ input })),
  };
});

jest.mock("@aws-sdk/client-secrets-manager", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    SecretsManagerClient: Client,
    GetSecretValueCommand: jest.fn((input: unknown) => ({ input })),
  };
});

jest.mock("@aws-sdk/client-dynamodb", () => {
  return { DynamoDBClient: jest.fn(() => ({})) };
});

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const send = jest.fn();
  const from = jest.fn(() => ({ send }));
  (from as any).__mockSend = send;
  return {
    DynamoDBDocumentClient: { from },
    DeleteCommand: jest.fn((input: unknown) => ({ input })),
  };
});

import { handler, verifySignature } from "../../github-webhook";

const mockSqsSend = (SQSClient as any).__mockSend as jest.Mock;
const mockSmSend = (SecretsManagerClient as any).__mockSend as jest.Mock;
const mockDdbSend = (DynamoDBDocumentClient as any).from.__mockSend as jest.Mock;

const WEBHOOK_SECRET = "test-secret";
const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/test-queue";

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

const INSTALLATIONS_TABLE = "openbrain-github-installations";

beforeEach(() => {
  mockSqsSend.mockReset();
  mockSqsSend.mockResolvedValue({});
  mockSmSend.mockReset();
  mockSmSend.mockResolvedValue({ SecretString: WEBHOOK_SECRET });
  mockDdbSend.mockReset();
  mockDdbSend.mockResolvedValue({});
  process.env.GITHUB_WEBHOOK_SECRET_NAME = "openbrain/github-webhook-secret";
  process.env.GITHUB_EVENTS_QUEUE_URL = QUEUE_URL;
  process.env.GITHUB_INSTALLATIONS_TABLE = INSTALLATIONS_TABLE;
});

describe("verifySignature", () => {
  it("returns true for a valid signature", () => {
    const body = '{"test":1}';
    expect(verifySignature(body, sign(body), WEBHOOK_SECRET)).toBe(true);
  });

  it("returns false for a wrong secret", () => {
    const body = '{"test":1}';
    expect(verifySignature(body, sign(body, "wrong"), WEBHOOK_SECRET)).toBe(false);
  });

  it("returns false for a missing signature", () => {
    expect(verifySignature("body", undefined, WEBHOOK_SECRET)).toBe(false);
  });

  it("returns false when secret is empty", () => {
    expect(verifySignature("body", sign("body"), "")).toBe(false);
  });
});

describe("handler", () => {
  type Result = { statusCode: number; body: string };

  function makeEvent(body: string, eventType: string, sig?: string, headerCase: "lower" | "upper" = "lower") {
    return {
      requestContext: { http: { method: "POST" } },
      headers: headerCase === "lower"
        ? { "x-github-event": eventType, "x-hub-signature-256": sig ?? sign(body) }
        : { "X-GitHub-Event": eventType, "X-Hub-Signature-256": sig ?? sign(body) },
      body,
      isBase64Encoded: false,
    };
  }

  it("returns 401 on invalid signature", async () => {
    const result = await handler(
      makeEvent('{"installation":{"id":1}}', "pull_request", "sha256=bad") as any
    ) as Result;
    expect(result.statusCode).toBe(401);
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it("accepts upper-case header variants", async () => {
    const body = JSON.stringify({ installation: { id: 1 } });
    const result = await handler(makeEvent(body, "push", undefined, "upper") as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and ignores irrelevant event types", async () => {
    const body = '{"installation":{"id":1}}';
    const result = await handler(makeEvent(body, "star") as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe("ignored");
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it("returns 200 ignored for events missing installation.id", async () => {
    const body = JSON.stringify({ action: "closed" }); // no installation field
    const result = await handler(makeEvent(body, "pull_request") as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reason).toBe("no installation");
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it("queues a pull_request event to SQS with the correct shape", async () => {
    const body = JSON.stringify({
      installation: { id: 42 },
      action: "closed",
      pull_request: { merged: true },
    });
    const result = await handler(makeEvent(body, "pull_request") as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody);
    expect(sent.eventType).toBe("pull_request");
    expect(sent.installationId).toBe(42);
  });

  it("queues push, release, and pull_request_review events", async () => {
    for (const eventType of ["push", "release", "pull_request_review"]) {
      mockSqsSend.mockClear();
      const body = JSON.stringify({ installation: { id: 1 } });
      const result = await handler(makeEvent(body, eventType) as any) as Result;
      expect(result.statusCode).toBe(200);
      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    }
  });

  it("decodes base64-encoded bodies before verifying the signature", async () => {
    const body = JSON.stringify({ installation: { id: 7 } });
    const encoded = Buffer.from(body).toString("base64");
    const event = {
      requestContext: { http: { method: "POST" } },
      headers: {
        "x-github-event": "push",
        "x-hub-signature-256": sign(body),
      },
      body: encoded,
      isBase64Encoded: true,
    };
    const result = await handler(event as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
  });

  it("installation deleted: deletes DynamoDB record and returns 200", async () => {
    const body = JSON.stringify({ action: "deleted", installation: { id: 99 } });
    const result = await handler(makeEvent(body, "installation") as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe("ok");
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    const deleteInput = mockDdbSend.mock.calls[0][0].input;
    expect(deleteInput.TableName).toBe(INSTALLATIONS_TABLE);
    expect(deleteInput.Key).toEqual({ installationId: "99" });
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it("installation created: ignores and returns 200 without touching DynamoDB or SQS", async () => {
    const body = JSON.stringify({ action: "created", installation: { id: 55 } });
    const result = await handler(makeEvent(body, "installation") as any) as Result;
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe("ok");
    expect(mockDdbSend).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
  });
});
