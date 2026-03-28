import type { APIGatewayProxyEventV2 } from "aws-lambda";

// Mock @ai-sdk/anthropic
const mockAnthropicProvider = jest.fn();
const mockCreateAnthropic = jest.fn(() => mockAnthropicProvider);
jest.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mockCreateAnthropic,
}));

// Mock ai streamText
const mockStreamText = jest.fn();
jest.mock("ai", () => ({
  streamText: mockStreamText,
  tool: (t: unknown) => t,
  stepCountIs: (n: number) => ({ type: "stepCount", count: n }),
}));

// Mock auth context
jest.mock("../../auth/context", () => ({
  extractUserContext: jest.fn(),
}));

// Mock tool executor
jest.mock("../../tool-executor", () => ({
  executeTool: jest.fn(),
}));

import { handler } from "../../chat";
import { extractUserContext } from "../../auth/context";
import { executeTool } from "../../tool-executor";

const mockExtractUserContext = extractUserContext as jest.MockedFunction<
  typeof extractUserContext
>;
const mockExecuteTool = executeTool as jest.MockedFunction<typeof executeTool>;

const USER = { userId: "user-123", displayName: "Alice" };

function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    requestContext: {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExtractUserContext.mockReturnValue(USER);
  mockAnthropicProvider.mockReturnValue({ modelId: "claude-haiku-4-5-20251001" });
  mockStreamText.mockReturnValue({ text: Promise.resolve("Hello!") });
});

describe("chat handler", () => {
  it("returns 401 when auth fails", async () => {
    mockExtractUserContext.mockImplementation(() => {
      throw new Error("Unauthorized");
    });

    const res = await handler(makeEvent({ messages: [{ role: "user", content: "hi" }] }));
    expect(res).toMatchObject({ statusCode: 401 });
  });

  it("returns 400 for invalid JSON body", async () => {
    const event = {
      body: "not json",
      requestContext: {},
    } as unknown as APIGatewayProxyEventV2;

    const res = await handler(event);
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it("returns 400 when messages array is empty", async () => {
    const res = await handler(makeEvent({ messages: [] }));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it("returns 400 when messages is missing", async () => {
    const res = await handler(makeEvent({}));
    expect(res).toMatchObject({ statusCode: 400 });
  });

  it("calls streamText and returns reply", async () => {
    mockStreamText.mockReturnValue({ text: Promise.resolve("Hi there!") });

    const res = await handler(
      makeEvent({ messages: [{ role: "user", content: "Hello" }] }),
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Open Brain"),
        messages: [{ role: "user", content: "Hello" }],
        stopWhen: expect.anything(),
      }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((res as any).body)).toEqual({ reply: "Hi there!" });
  });

  it("passes stopWhen with 10-step limit to streamText", async () => {
    await handler(makeEvent({ messages: [{ role: "user", content: "hi" }] }));

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({ stopWhen: expect.objectContaining({ count: 10 }) }),
    );
  });

  it("includes all 7 tools in streamText call", async () => {
    await handler(makeEvent({ messages: [{ role: "user", content: "hi" }] }));

    const call = mockStreamText.mock.calls[0][0];
    expect(Object.keys(call.tools)).toEqual(
      expect.arrayContaining([
        "search_thoughts",
        "browse_recent",
        "stats",
        "capture_thought",
        "schedule_task",
        "list_tasks",
        "cancel_task",
      ]),
    );
  });

  it("returns 500 on streamText error", async () => {
    mockStreamText.mockReturnValue({
      text: Promise.reject(new Error("LLM error")),
    });

    const res = await handler(
      makeEvent({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res).toMatchObject({ statusCode: 500 });
    expect(JSON.parse((res as any).body)).toMatchObject({ error: "LLM error" });
  });

  it("handles non-Error throws gracefully", async () => {
    mockStreamText.mockReturnValue({
      text: Promise.reject("string error"),
    });

    const res = await handler(
      makeEvent({ messages: [{ role: "user", content: "hi" }] }),
    );

    expect(res).toMatchObject({ statusCode: 500 });
    expect(JSON.parse((res as any).body)).toMatchObject({ error: "string error" });
  });

  it("tool execute functions call executeTool with user context", async () => {
    mockExecuteTool.mockResolvedValue("search results");
    let capturedTools: Record<string, any> = {};
    mockStreamText.mockImplementation((opts: any) => {
      capturedTools = opts.tools;
      return { text: Promise.resolve("done") };
    });

    await handler(makeEvent({ messages: [{ role: "user", content: "hi" }] }));

    // Call the search_thoughts execute function directly
    await capturedTools.search_thoughts.execute({ query: "test" });
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "search_thoughts",
      { query: "test" },
      USER,
    );
  });
});
