import { handleCaptureThought } from "../capture-thought";
import * as vectors from "../../services/vectors";
import * as embeddings from "../../services/embeddings";
import * as metadata from "../../services/metadata";

jest.mock("../../services/vectors");
jest.mock("../../services/embeddings");
jest.mock("../../services/metadata");

const mockEnsurePrivateIndex = vectors.ensurePrivateIndex as jest.MockedFunction<typeof vectors.ensurePrivateIndex>;
const mockPutVector = vectors.putVector as jest.MockedFunction<typeof vectors.putVector>;
const mockGenerateEmbedding = embeddings.generateEmbedding as jest.MockedFunction<typeof embeddings.generateEmbedding>;
const mockExtractMetadata = metadata.extractMetadata as jest.MockedFunction<typeof metadata.extractMetadata>;

const USER = { userId: "user-123", displayName: "Alice" };
const EMBEDDING = [0.1, 0.2, 0.3];

beforeEach(() => {
  jest.clearAllMocks();
  mockEnsurePrivateIndex.mockResolvedValue("private-user-123");
  mockPutVector.mockResolvedValue(undefined);
  mockGenerateEmbedding.mockResolvedValue(EMBEDDING);
  mockExtractMetadata.mockResolvedValue({
    type: "observation",
    topics: ["work"],
    people: [],
    action_items: [],
    dates_mentioned: [],
  });
});

describe("handleCaptureThought", () => {
  it("returns error and does not call services when text is missing", async () => {
    const result = await handleCaptureThought({ text: "" }, USER);
    expect(result).toBe("Error: text is required");
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockExtractMetadata).not.toHaveBeenCalled();
  });

  it("returns error and does not call services when text exceeds 50k characters", async () => {
    const result = await handleCaptureThought({ text: "a".repeat(50_001) }, USER);
    expect(result).toBe("Error: text exceeds maximum length of 50,000 characters");
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockExtractMetadata).not.toHaveBeenCalled();
  });

  it("captures a private thought and returns confirmation", async () => {
    const result = await handleCaptureThought({ text: "Had a great meeting" }, USER);

    expect(mockEnsurePrivateIndex).toHaveBeenCalledWith(USER.userId);
    expect(mockPutVector).toHaveBeenCalledWith(
      "private-user-123",
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({
        user_id: USER.userId,
        content: "Had a great meeting",
        type: "observation",
        action_items: "[]",
        dates_mentioned: "[]",
      })
    );
    expect(result).toContain("Captured as observation");
    expect(result).toContain("work");
  });

  it("captures a shared thought and sets display_name", async () => {
    await handleCaptureThought({ text: "Team update", scope: "shared" }, USER);

    expect(mockEnsurePrivateIndex).not.toHaveBeenCalled();
    expect(mockPutVector).toHaveBeenCalledWith(
      "shared",
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({ display_name: "Alice" })
    );
  });

  it("includes agent_id for shared captures when agentName is set", async () => {
    const agentUser = { ...USER, agentName: "my-agent" };

    await handleCaptureThought({ text: "Agent update", scope: "shared" }, agentUser);

    expect(mockPutVector).toHaveBeenCalledWith(
      "shared",
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({ agent_id: "my-agent" })
    );
  });

  it("falls back to 'anonymous' display_name for shared capture when not set", async () => {
    const anonymousUser = { userId: "user-456" };

    await handleCaptureThought({ text: "Anon update", scope: "shared" }, anonymousUser);

    expect(mockPutVector).toHaveBeenCalledWith(
      "shared",
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({ display_name: "anonymous" })
    );
  });

  it("omits topics and people from metadata when empty (S3 Vectors rejects empty arrays)", async () => {
    mockExtractMetadata.mockResolvedValue({
      type: "idea",
      topics: [],
      people: [],
      action_items: [],
      dates_mentioned: [],
    });

    await handleCaptureThought({ text: "Just an idea" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call).not.toHaveProperty("topics");
    expect(call).not.toHaveProperty("people");
  });

  it("includes people in confirmation when present", async () => {
    mockExtractMetadata.mockResolvedValue({
      type: "person_note",
      topics: [],
      people: ["Bob"],
      action_items: [],
      dates_mentioned: [],
    });

    const result = await handleCaptureThought({ text: "Met Bob" }, USER);

    expect(result).toContain("People: Bob");
  });

  it("includes action items in confirmation when present", async () => {
    mockExtractMetadata.mockResolvedValue({
      type: "task",
      topics: ["work"],
      people: [],
      action_items: ["Follow up with team"],
      dates_mentioned: [],
    });

    const result = await handleCaptureThought({ text: "Need to follow up" }, USER);

    expect(result).toContain("Action items: Follow up with team");
  });

  it("sets tenant_id on shared captures for multi-tenant scoping", async () => {
    await handleCaptureThought({ text: "Team update", scope: "shared" }, USER);

    expect(mockPutVector).toHaveBeenCalledWith(
      "shared",
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({ tenant_id: USER.userId })
    );
  });

  it("does not set tenant_id on private captures", async () => {
    await handleCaptureThought({ text: "Private note" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call).not.toHaveProperty("tenant_id");
  });

  it("includes media_url in metadata when provided", async () => {
    await handleCaptureThought(
      { text: "Photo from the event", media_url: "https://example.com/photo.jpg" },
      USER
    );

    expect(mockPutVector).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({ media_url: "https://example.com/photo.jpg" })
    );
  });

  it("omits media_url from metadata when not provided", async () => {
    await handleCaptureThought({ text: "No media here" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call).not.toHaveProperty("media_url");
  });

  it("serializes action_items and dates_mentioned as JSON strings", async () => {
    mockExtractMetadata.mockResolvedValue({
      type: "task",
      topics: [],
      people: [],
      action_items: ["Do X", "Do Y"],
      dates_mentioned: ["2026-03-01"],
    });

    await handleCaptureThought({ text: "Task with dates" }, USER);

    expect(mockPutVector).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({
        action_items: '["Do X","Do Y"]',
        dates_mentioned: '["2026-03-01"]',
      })
    );
  });
});
