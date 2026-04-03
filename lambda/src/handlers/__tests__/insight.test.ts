import { handleInsight } from "../insight";
import * as vectors from "../../services/vectors";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

jest.mock("../../services/vectors");
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  ConverseCommand: jest.fn((input: unknown) => ({ input })),
}));

const mockListAllVectors = vectors.listAllVectors as jest.MockedFunction<
  typeof vectors.listAllVectors
>;

// insight.ts creates a module-level BedrockRuntimeClient singleton at import time.
// mock.instances tracks `this`, not the returned object — use mock.results instead.
let mockSend: jest.Mock;
beforeAll(() => {
  mockSend = (
    (BedrockRuntimeClient as unknown as jest.Mock).mock.results[0].value as any
  ).send as jest.Mock;
});

const USER = { userId: "user-123" };
const NOW = 1_743_000_000_000;
const RECENT = NOW - 2 * 24 * 60 * 60 * 1000;
const OLD = NOW - 10 * 24 * 60 * 60 * 1000;

function makeVector(topics: string[], createdAt: number, content = "some thought") {
  return {
    key: `key-${Math.random()}`,
    metadata: { topics, created_at: createdAt, content, type: "idea" },
  };
}

function mockBedrockReply(text: string) {
  mockSend.mockResolvedValue({
    output: { message: { content: [{ text }] } },
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("handleInsight", () => {
  it("returns null when there are no recent thoughts", async () => {
    mockListAllVectors.mockResolvedValue([]);
    const result = await handleInsight(USER);
    expect(result).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns null when recent thoughts are below the minimum threshold", async () => {
    mockListAllVectors.mockResolvedValue([makeVector(["agent-arch"], RECENT)]);
    const result = await handleInsight(USER);
    expect(result).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("ignores thoughts older than 7 days", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector(["agent-arch"], OLD),
      makeVector(["agent-arch"], OLD),
      makeVector(["agent-arch"], OLD),
    ]);
    const result = await handleInsight(USER);
    expect(result).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns insight for the hottest topic cluster", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector(["agent-arch"], RECENT, "fleet design doc"),
      makeVector(["agent-arch"], RECENT, "task discovery spec"),
      makeVector(["agent-arch"], RECENT, "A2A registry"),
      makeVector(["other-topic"], RECENT, "unrelated"),
      makeVector(["other-topic"], RECENT, "also unrelated"),
    ]);
    mockBedrockReply(
      "Your thinking is coalescing around fleet architecture. It looks like Phase 4 is ready to kick off."
    );

    const result = await handleInsight(USER);

    expect(result).not.toBeNull();
    expect(result!.topic).toBe("agent-arch");
    expect(result!.count).toBe(3);
    expect(result!.headline).toContain("fleet architecture");
  });

  it("splits the first sentence into headline and remainder into body", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector(["testing"], RECENT),
      makeVector(["testing"], RECENT),
    ]);
    mockBedrockReply("First sentence here. Second sentence follows.");

    const result = await handleInsight(USER);

    expect(result!.headline).toBe("First sentence here.");
    expect(result!.body).toBe("Second sentence follows.");
  });

  it("uses full text as headline when there is only one sentence", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector(["testing"], RECENT),
      makeVector(["testing"], RECENT),
    ]);
    mockBedrockReply("Only one sentence returned");

    const result = await handleInsight(USER);

    expect(result!.headline).toBe("Only one sentence returned");
    expect(result!.body).toBe("");
  });

  it("returns null when Bedrock returns empty text", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector(["testing"], RECENT),
      makeVector(["testing"], RECENT),
    ]);
    mockSend.mockResolvedValue({ output: { message: { content: [] } } });

    const result = await handleInsight(USER);
    expect(result).toBeNull();
  });

  it("sends snippet count not thought count in the prompt when capped", async () => {
    const manyThoughts = Array.from({ length: 10 }, (_, i) =>
      makeVector(["big-topic"], RECENT, `thought ${i}`)
    );
    mockListAllVectors.mockResolvedValue(manyThoughts);
    mockBedrockReply("Pattern sentence one. Pattern sentence two.");

    await handleInsight(USER);

    const converseArg = (ConverseCommand as unknown as jest.Mock).mock.calls[0][0];
    const prompt: string = converseArg.messages[0].content[0].text;
    expect(prompt).toMatch(/6 snippets from 10 thoughts/);
  });

  it("queries the correct private index for the user", async () => {
    mockListAllVectors.mockResolvedValue([]);
    await handleInsight({ userId: "abc-456" });
    expect(mockListAllVectors).toHaveBeenCalledWith("private-abc-456");
  });
});
