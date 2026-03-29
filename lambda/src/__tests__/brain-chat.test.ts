// Set required env vars before any module initializes
process.env.USER_POOL_ID = "us-east-1_test";
process.env.USER_POOL_CLIENT_ID = "test-client";

import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeModelCommand: jest.fn().mockImplementation((input) => input),
}));
jest.mock("../auth/verify");
jest.mock("../tool-executor");

import { handler } from "../brain-chat";
import * as verifyModule from "../auth/verify";
import * as toolExecutorModule from "../tool-executor";

const mockVerifyAuth = verifyModule.verifyAuth as jest.MockedFunction<typeof verifyModule.verifyAuth>;
const mockExecuteTool = toolExecutorModule.executeTool as jest.MockedFunction<typeof toolExecutorModule.executeTool>;

const USER = { userId: "user-123", displayName: "Alice" };

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: "POST" } } as never,
    headers: { authorization: "Bearer token" },
    body: JSON.stringify({ message: "What do I know about AWS?" }),
    rawPath: "/brain/chat",
    ...overrides,
  } as APIGatewayProxyEventV2;
}

function bedrockTextResponse(text: string) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
      })
    ),
  };
}

function bedrockToolUseResponse(toolName: string, toolId: string, input: Record<string, unknown>) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: toolId, name: toolName, input }],
      })
    ),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyAuth.mockResolvedValue(USER);
});

describe("brain-chat handler", () => {
  it("returns 401 when auth fails", async () => {
    mockVerifyAuth.mockRejectedValue(new Error("Unauthorized"));
    const result = await handler(makeEvent());
    expect(result).toMatchObject({ statusCode: 401 });
  });

  it("returns 400 when message is missing", async () => {
    const result = await handler(makeEvent({ body: JSON.stringify({}) }));
    expect(result).toMatchObject({ statusCode: 400 });
  });

  it("returns 400 for malformed JSON body", async () => {
    const result = await handler(makeEvent({ body: "not-json" }));
    expect(result).toMatchObject({ statusCode: 400 });
  });

  it("returns 200 with text response on end_turn", async () => {
    mockSend.mockResolvedValueOnce(bedrockTextResponse("I remember you've been working on AWS."));

    const result = await handler(makeEvent());
    expect(result).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((result as { body: string }).body);
    expect(body.response).toBe("I remember you've been working on AWS.");
    expect(body.toolsUsed).toEqual([]);
  });

  it("executes a tool and returns final text response", async () => {
    const toolResult = JSON.stringify({ thoughts: [{ text: "AWS note" }, { text: "Another note" }] });
    mockExecuteTool.mockResolvedValueOnce(toolResult);

    mockSend
      .mockResolvedValueOnce(bedrockToolUseResponse("search_thoughts", "tu_1", { query: "AWS" }))
      .mockResolvedValueOnce(bedrockTextResponse("I found 2 memories about AWS."));

    const result = await handler(makeEvent());
    expect(result).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((result as { body: string }).body);
    expect(body.toolsUsed).toContain("search_thoughts");
    expect(body.thoughtsReferenced).toBe(2);
    expect(body.response).toBe("I found 2 memories about AWS.");
  });

  it("handles OPTIONS preflight", async () => {
    const result = await handler(makeEvent({
      requestContext: { http: { method: "OPTIONS" } } as never,
    }));
    expect(result).toMatchObject({ statusCode: 204 });
  });
});
