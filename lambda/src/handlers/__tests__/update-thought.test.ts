import { handleUpdateThought } from "../update-thought";
import * as vectors from "../../services/vectors";
import * as embeddings from "../../services/embeddings";
import * as metadata from "../../services/metadata";

jest.mock("../../services/vectors");
jest.mock("../../services/embeddings");
jest.mock("../../services/metadata");

const mockGetVector = vectors.getVector as jest.MockedFunction<typeof vectors.getVector>;
const mockPutVector = vectors.putVector as jest.MockedFunction<typeof vectors.putVector>;
const mockGenerateEmbedding = embeddings.generateEmbedding as jest.MockedFunction<
  typeof embeddings.generateEmbedding
>;
const mockExtractMetadata = metadata.extractMetadata as jest.MockedFunction<
  typeof metadata.extractMetadata
>;

const USER = { userId: "user-123", displayName: "Alice" };
const OTHER_USER = { userId: "user-999" };
const THOUGHT_ID = "thought-abc";
const EXISTING_VECTOR = {
  key: THOUGHT_ID,
  metadata: {
    user_id: "user-123",
    created_at: 1700000000000,
    content: "original text",
    type: "observation",
    action_items: "[]",
    dates_mentioned: "[]",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  mockExtractMetadata.mockResolvedValue({
    type: "observation",
    topics: ["work"],
    people: [],
    action_items: [],
    dates_mentioned: [],
  });
  mockPutVector.mockResolvedValue(undefined);
});

describe("handleUpdateThought", () => {
  it("updates own private thought and returns confirmation", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    const result = await handleUpdateThought(
      { id: THOUGHT_ID, text: "updated text" },
      USER
    );

    expect(mockGetVector).toHaveBeenCalledWith(`private-${USER.userId}`, THOUGHT_ID);
    expect(mockPutVector).toHaveBeenCalledWith(
      `private-${USER.userId}`,
      THOUGHT_ID,
      [0.1, 0.2, 0.3],
      expect.objectContaining({
        user_id: USER.userId,
        created_at: EXISTING_VECTOR.metadata.created_at,
        content: "updated text",
      })
    );
    expect(result).toContain("Updated as observation");
    expect(result).toContain("work");
  });

  it("updates own shared thought", async () => {
    const sharedVector = {
      ...EXISTING_VECTOR,
      metadata: { ...EXISTING_VECTOR.metadata },
    };
    mockGetVector.mockResolvedValue(sharedVector);

    const result = await handleUpdateThought(
      { id: THOUGHT_ID, text: "shared update", scope: "shared" },
      USER
    );

    expect(mockGetVector).toHaveBeenCalledWith("shared", THOUGHT_ID);
    expect(mockPutVector).toHaveBeenCalledWith(
      "shared",
      THOUGHT_ID,
      expect.any(Array),
      expect.objectContaining({ display_name: "Alice" })
    );
    expect(result).toContain("Updated as observation");
  });

  it("includes people in confirmation when present", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);
    mockExtractMetadata.mockResolvedValue({
      type: "person_note",
      topics: ["team"],
      people: ["Bob"],
      action_items: [],
      dates_mentioned: [],
    });

    const result = await handleUpdateThought(
      { id: THOUGHT_ID, text: "Met with Bob today" },
      USER
    );

    expect(result).toContain("People: Bob");
  });

  it("returns error when thought is not found", async () => {
    mockGetVector.mockResolvedValue(null);

    const result = await handleUpdateThought(
      { id: THOUGHT_ID, text: "updated text" },
      USER
    );

    expect(result).toBe(`Error: thought not found (id: ${THOUGHT_ID})`);
    expect(mockPutVector).not.toHaveBeenCalled();
  });

  it("returns permission error when thought belongs to another user", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    const result = await handleUpdateThought(
      { id: THOUGHT_ID, text: "updated text" },
      OTHER_USER
    );

    expect(result).toBe("Error: you do not have permission to edit this thought");
    expect(mockPutVector).not.toHaveBeenCalled();
  });

  it("denies update when existing thought has no user_id (secure default)", async () => {
    const noOwnerVector = {
      key: THOUGHT_ID,
      metadata: { content: "orphan thought", created_at: 1700000000000 },
    };
    mockGetVector.mockResolvedValue(noOwnerVector);

    const result = await handleUpdateThought(
      { id: THOUGHT_ID, text: "updated text" },
      USER
    );

    expect(result).toBe("Error: you do not have permission to edit this thought");
    expect(mockPutVector).not.toHaveBeenCalled();
  });

  it("falls back to Date.now() for created_at when missing from existing vector", async () => {
    const noTimestampVector = {
      key: THOUGHT_ID,
      metadata: { user_id: "user-123", content: "old thought" },
    };
    mockGetVector.mockResolvedValue(noTimestampVector);
    jest.spyOn(Date, "now").mockReturnValue(9999999999);

    await handleUpdateThought({ id: THOUGHT_ID, text: "updated text" }, USER);

    expect(mockPutVector).toHaveBeenCalledWith(
      expect.any(String),
      THOUGHT_ID,
      expect.any(Array),
      expect.objectContaining({ created_at: 9999999999 })
    );

    jest.restoreAllMocks();
  });

  it("sets tenant_id on shared thought updates", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    await handleUpdateThought(
      { id: THOUGHT_ID, text: "updated shared", scope: "shared" },
      USER
    );

    expect(mockPutVector).toHaveBeenCalledWith(
      "shared",
      THOUGHT_ID,
      expect.any(Array),
      expect.objectContaining({ tenant_id: USER.userId })
    );
  });

  it("does not set tenant_id on private thought updates", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    await handleUpdateThought({ id: THOUGHT_ID, text: "updated private" }, USER);

    const call = mockPutVector.mock.calls[0][3];
    expect(call).not.toHaveProperty("tenant_id");
  });
});
