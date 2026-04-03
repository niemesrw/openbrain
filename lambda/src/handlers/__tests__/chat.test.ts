import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { Writable } from "stream";

// ── Mock awslambda global (Lambda streaming runtime) ─────────────────────────
// streamifyResponse: store and immediately return the inner handler so tests
// can call it directly.  HttpResponseStream.from: return a Writable that
// collects chunks so tests can inspect what was written.

type StreamHandler = (
  event: APIGatewayProxyEventV2,
  responseStream: NodeJS.WritableStream,
  context: Context,
) => Promise<void>;

let capturedInnerHandler: StreamHandler | null = null;

const mockHttpResponseStream = {
  chunks: [] as Buffer[],
  metadata: null as null | { statusCode: number; headers?: Record<string, string> },
};

(global as any).awslambda = {
  streamifyResponse: (handler: StreamHandler) => {
    capturedInnerHandler = handler;
    return handler; // return as-is so tests can call handler(event, stream, ctx)
  },
  HttpResponseStream: {
    from: (
      responseStream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers?: Record<string, string> },
    ) => {
      mockHttpResponseStream.metadata = metadata;
      mockHttpResponseStream.chunks = [];
      const writable = new Writable({
        write(chunk, _enc, cb) {
          mockHttpResponseStream.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          cb();
        },
      });
      (writable as any).end = () => responseStream.end();
      return writable;
    },
  },
};

// ── Mock @ai-sdk/amazon-bedrock ───────────────────────────────────────────────
const mockBedrockModel = jest.fn().mockReturnValue({ modelId: "us.anthropic.claude-haiku" });
const mockCreateAmazonBedrock = jest.fn(() => mockBedrockModel);
jest.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: mockCreateAmazonBedrock,
}));

// ── Mock ai streamText ────────────────────────────────────────────────────────
const mockStreamText = jest.fn();
jest.mock("ai", () => ({
  streamText: mockStreamText,
  tool: (t: unknown) => t,
}));

// ── Mock auth + tool executor ─────────────────────────────────────────────────
jest.mock("../../auth/verify", () => ({
  verifyAuth: jest.fn(),
}));
jest.mock("../../tool-executor", () => ({
  executeTool: jest.fn(),
}));

import { handler } from "../../chat";
import { verifyAuth } from "../../auth/verify";
import { executeTool } from "../../tool-executor";

const mockVerifyAuth = verifyAuth as jest.MockedFunction<typeof verifyAuth>;
const mockExecuteTool = executeTool as jest.MockedFunction<typeof executeTool>;

const USER = { userId: "user-123", displayName: "Alice" };

function makeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    requestContext: {},
  } as unknown as APIGatewayProxyEventV2;
}

function makeResponseStream() {
  const writable = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  writable.end = () => writable;
  return { stream: writable };
}

function makeDataStream(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`0:"${text}"\n`));
      controller.close();
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyAuth.mockResolvedValue(USER);
  mockStreamText.mockReturnValue({ toDataStream: () => makeDataStream("Hello!") });
  mockHttpResponseStream.chunks = [];
  mockHttpResponseStream.metadata = null;
});

describe("chat handler", () => {
  it("sends 401 when auth fails", async () => {
    mockVerifyAuth.mockRejectedValueOnce(new Error("Unauthorized"));

    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(makeEvent({ messages: [{ role: "user", content: "hi" }] }), stream, {} as Context);

    expect(mockHttpResponseStream.metadata?.statusCode).toBe(401);
  });

  it("sends 400 for invalid JSON body", async () => {
    const event = { body: "not json", requestContext: {} } as unknown as APIGatewayProxyEventV2;
    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(event, stream, {} as Context);

    expect(mockHttpResponseStream.metadata?.statusCode).toBe(400);
  });

  it("sends 400 when messages array is empty", async () => {
    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(makeEvent({ messages: [] }), stream, {} as Context);

    expect(mockHttpResponseStream.metadata?.statusCode).toBe(400);
  });

  it("sends 400 when messages is missing", async () => {
    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(makeEvent({}), stream, {} as Context);

    expect(mockHttpResponseStream.metadata?.statusCode).toBe(400);
  });

  it("calls streamText and streams data with 200 status", async () => {
    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(
      makeEvent({ messages: [{ role: "user", content: "Hello" }] }),
      stream,
      {} as Context,
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Open Brain"),
        messages: [{ role: "user", content: "Hello" }],
        maxSteps: 10,
      }),
    );
    expect(mockHttpResponseStream.metadata?.statusCode).toBe(200);
    expect(mockHttpResponseStream.metadata?.headers?.["x-vercel-ai-data-stream"]).toBe("v1");
  });

  it("includes all 7 tools in streamText call", async () => {
    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(makeEvent({ messages: [{ role: "user", content: "hi" }] }), stream, {} as Context);

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

  it("tool execute functions call executeTool with user context", async () => {
    mockExecuteTool.mockResolvedValue("search results");
    let capturedTools: Record<string, any> = {};
    mockStreamText.mockImplementation((opts: any) => {
      capturedTools = opts.tools;
      return { toDataStream: () => makeDataStream("done") };
    });

    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(makeEvent({ messages: [{ role: "user", content: "hi" }] }), stream, {} as Context);

    await capturedTools.search_thoughts.execute({ query: "test" });
    expect(mockExecuteTool).toHaveBeenCalledWith("search_thoughts", { query: "test" }, USER);
  });

  it("writes error data event when streamText throws", async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error("LLM error");
    });

    const { stream } = makeResponseStream();
    await (handler as StreamHandler)(makeEvent({ messages: [{ role: "user", content: "hi" }] }), stream, {} as Context);

    // Error thrown after headers sent — still streams with 200, error written as data event
    expect(mockHttpResponseStream.metadata?.statusCode).toBe(200);
    const written = Buffer.concat(mockHttpResponseStream.chunks).toString();
    expect(written).toContain("LLM error");
  });
});
