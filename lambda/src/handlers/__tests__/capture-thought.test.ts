import { handleCaptureThought } from "../capture-thought";
import * as vectors from "../../services/vectors";
import * as embeddings from "../../services/embeddings";
import * as metadata from "../../services/metadata";
import * as ogImage from "../../services/og-image";
import * as vision from "../../services/vision";

jest.mock("../../services/vectors");
jest.mock("../../services/embeddings");
jest.mock("../../services/metadata");
jest.mock("../../services/og-image");
jest.mock("../../services/vision");

const mockSqsSend = jest.fn().mockResolvedValue({});
jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((...args: unknown[]) => ({ input: args[0] })),
}));

const mockEnsurePrivateIndex = vectors.ensurePrivateIndex as jest.MockedFunction<typeof vectors.ensurePrivateIndex>;
const mockPutVector = vectors.putVector as jest.MockedFunction<typeof vectors.putVector>;
const mockGenerateEmbedding = embeddings.generateEmbedding as jest.MockedFunction<typeof embeddings.generateEmbedding>;
const mockExtractMetadata = metadata.extractMetadata as jest.MockedFunction<typeof metadata.extractMetadata>;
const mockFetchOgImage = ogImage.fetchOgImage as jest.MockedFunction<typeof ogImage.fetchOgImage>;
const mockDescribeImage = vision.describeImage as jest.MockedFunction<typeof vision.describeImage>;

const USER = { userId: "user-123", displayName: "Alice" };
const EMBEDDING = [0.1, 0.2, 0.3];

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SLACK_NOTIFY_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/openbrain-slack-notify" };
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
  mockFetchOgImage.mockResolvedValue(undefined);
  mockDescribeImage.mockResolvedValue(undefined);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
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

  it("fetches og:image from source_url and stores it as media_url when no media_url is provided", async () => {
    mockFetchOgImage.mockResolvedValue("https://example.com/og-image.jpg");

    await handleCaptureThought(
      { text: "Interesting article", source_url: "https://example.com/article" },
      USER
    );

    expect(mockFetchOgImage).toHaveBeenCalledWith("https://example.com/article");
    expect(mockPutVector).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({
        media_url: "https://example.com/og-image.jpg",
        source_url: "https://example.com/article",
      })
    );
  });

  it("uses explicit media_url and does not call fetchOgImage when both are provided", async () => {
    await handleCaptureThought(
      {
        text: "Article with custom image",
        media_url: "https://example.com/custom.jpg",
        source_url: "https://example.com/article",
      },
      USER
    );

    expect(mockFetchOgImage).not.toHaveBeenCalled();
    expect(mockPutVector).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({
        media_url: "https://example.com/custom.jpg",
        source_url: "https://example.com/article",
      })
    );
  });

  it("stores source_url in metadata even when og:image is not found", async () => {
    mockFetchOgImage.mockResolvedValue(undefined);

    await handleCaptureThought(
      { text: "Article without og:image", source_url: "https://example.com/no-og" },
      USER
    );

    const call = mockPutVector.mock.calls[0][3];
    expect(call).toHaveProperty("source_url", "https://example.com/no-og");
    expect(call).not.toHaveProperty("media_url");
  });

  it("does not call fetchOgImage when source_url is not provided", async () => {
    await handleCaptureThought({ text: "No source URL" }, USER);

    expect(mockFetchOgImage).not.toHaveBeenCalled();
  });

  it("omits source_url from metadata when not provided", async () => {
    await handleCaptureThought({ text: "No source URL" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call).not.toHaveProperty("source_url");
  });

  it("stores _source in metadata when provided", async () => {
    await handleCaptureThought({ text: "GitHub PR merged", _source: "github" }, USER);

    expect(mockPutVector).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      EMBEDDING,
      expect.objectContaining({ source: "github" })
    );
  });

  it("omits source from metadata when _source is not provided", async () => {
    await handleCaptureThought({ text: "User thought" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call).not.toHaveProperty("source");
  });

  it("overrides AI-chosen type when args.type is provided", async () => {
    mockExtractMetadata.mockResolvedValue({
      type: "observation",
      topics: ["test"],
      people: [],
      action_items: [],
      dates_mentioned: [],
    });

    await handleCaptureThought({ text: "Buy milk", type: "task" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call.type).toBe("task");
  });

  it("calls describeImage and appends description when text is short and media_url is present", async () => {
    mockDescribeImage.mockResolvedValue("A scenic mountain landscape at sunset.");

    await handleCaptureThought(
      { text: "Nice photo", media_url: "https://example.com/photo.jpg" },
      USER
    );

    expect(mockDescribeImage).toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Nice photo\n\nA scenic mountain landscape at sunset.");
    expect(mockExtractMetadata).toHaveBeenCalledWith("Nice photo\n\nA scenic mountain landscape at sunset.");
    const call = mockPutVector.mock.calls[0][3];
    expect(call.content).toBe("Nice photo\n\nA scenic mountain landscape at sunset.");
  });

  it("calls describeImage and appends description to URL-only text, preserving the URL", async () => {
    mockDescribeImage.mockResolvedValue("A product photo showing blue sneakers.");

    await handleCaptureThought(
      { text: "https://example.com/image.jpg", media_url: "https://example.com/image.jpg" },
      USER
    );

    expect(mockDescribeImage).toHaveBeenCalledWith("https://example.com/image.jpg");
    const call = mockPutVector.mock.calls[0][3];
    expect(call.content).toBe("https://example.com/image.jpg\n\nA product photo showing blue sneakers.");
  });

  it("does not call describeImage when text is long (≥50 chars)", async () => {
    const longText = "This is a sufficiently long thought that should not trigger vision at all.";

    await handleCaptureThought(
      { text: longText, media_url: "https://example.com/photo.jpg" },
      USER
    );

    expect(mockDescribeImage).not.toHaveBeenCalled();
    const call = mockPutVector.mock.calls[0][3];
    expect(call.content).toBe(longText);
  });

  it("does not call describeImage when no media_url is present", async () => {
    await handleCaptureThought({ text: "Short" }, USER);

    expect(mockDescribeImage).not.toHaveBeenCalled();
  });

  it("falls back to original text when describeImage returns undefined", async () => {
    mockDescribeImage.mockResolvedValue(undefined);

    await handleCaptureThought(
      { text: "Brief note", media_url: "https://example.com/photo.jpg" },
      USER
    );

    expect(mockDescribeImage).toHaveBeenCalled();
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Brief note");
    const call = mockPutVector.mock.calls[0][3];
    expect(call.content).toBe("Brief note");
  });

  describe("Slack notify SQS enqueue", () => {
    it("enqueues SQS message when topic is channel:notify", async () => {
      mockExtractMetadata.mockResolvedValue({
        type: "observation",
        topics: ["channel:notify", "aws"],
        people: [],
        action_items: [],
        dates_mentioned: [],
      });

      await handleCaptureThought({ text: "Deployment finished" }, USER);

      expect(mockSqsSend).toHaveBeenCalledTimes(1);
      const [cmd] = mockSqsSend.mock.calls[0];
      const body = JSON.parse(cmd.input.MessageBody);
      expect(body.userId).toBe(USER.userId);
      expect(body.topics).toContain("channel:notify");
      expect(body.text).toBe("Deployment finished");
      expect(body.thoughtId).toBeDefined();
    });

    it("enqueues SQS message when topic is channel:alert", async () => {
      mockExtractMetadata.mockResolvedValue({
        type: "observation",
        topics: ["channel:alert"],
        people: [],
        action_items: [],
        dates_mentioned: [],
      });

      await handleCaptureThought({ text: "Error rate spiked" }, USER);

      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });

    it("enqueues SQS message when topic is channel:shared", async () => {
      mockExtractMetadata.mockResolvedValue({
        type: "idea",
        topics: ["channel:shared"],
        people: [],
        action_items: [],
        dates_mentioned: [],
      });

      await handleCaptureThought({ text: "Shared idea" }, USER);

      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });

    it("does NOT enqueue SQS message when no channel: topic is present", async () => {
      mockExtractMetadata.mockResolvedValue({
        type: "observation",
        topics: ["work", "aws"],
        people: [],
        action_items: [],
        dates_mentioned: [],
      });

      await handleCaptureThought({ text: "Regular thought" }, USER);

      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    it("does NOT enqueue SQS message when SLACK_NOTIFY_QUEUE_URL is not set", async () => {
      delete process.env.SLACK_NOTIFY_QUEUE_URL;
      mockExtractMetadata.mockResolvedValue({
        type: "observation",
        topics: ["channel:notify"],
        people: [],
        action_items: [],
        dates_mentioned: [],
      });

      await handleCaptureThought({ text: "Notification thought" }, USER);

      expect(mockSqsSend).not.toHaveBeenCalled();
    });

    it("does not throw when SQS send fails — capture still succeeds", async () => {
      mockSqsSend.mockRejectedValueOnce(new Error("SQS unavailable"));
      mockExtractMetadata.mockResolvedValue({
        type: "observation",
        topics: ["channel:notify"],
        people: [],
        action_items: [],
        dates_mentioned: [],
      });

      const result = await handleCaptureThought({ text: "Notification thought" }, USER);

      expect(result).toContain("Captured as observation");
    });
  });
});
