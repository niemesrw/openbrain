import { handleDeleteThought } from "../delete-thought";
import * as vectors from "../../services/vectors";

jest.mock("../../services/vectors");

const mockGetVector = vectors.getVector as jest.MockedFunction<typeof vectors.getVector>;
const mockDeleteVector = vectors.deleteVector as jest.MockedFunction<typeof vectors.deleteVector>;

const USER = { userId: "user-123" };
const OTHER_USER = { userId: "user-999" };
const THOUGHT_ID = "thought-abc";
const EXISTING_VECTOR = {
  key: THOUGHT_ID,
  metadata: {
    user_id: "user-123",
    created_at: 1700000000000,
    content: "a thought",
    type: "observation",
    action_items: "[]",
    dates_mentioned: "[]",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteVector.mockResolvedValue(undefined);
});

describe("handleDeleteThought", () => {
  it("deletes own private thought and returns confirmation", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    const result = await handleDeleteThought({ id: THOUGHT_ID }, USER);

    expect(mockGetVector).toHaveBeenCalledWith(`private-${USER.userId}`, THOUGHT_ID);
    expect(mockDeleteVector).toHaveBeenCalledWith(`private-${USER.userId}`, THOUGHT_ID);
    expect(result).toBe(`Deleted thought ${THOUGHT_ID}`);
  });

  it("deletes own shared thought", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    const result = await handleDeleteThought(
      { id: THOUGHT_ID, scope: "shared" },
      USER
    );

    expect(mockGetVector).toHaveBeenCalledWith("shared", THOUGHT_ID);
    expect(mockDeleteVector).toHaveBeenCalledWith("shared", THOUGHT_ID);
    expect(result).toBe(`Deleted thought ${THOUGHT_ID}`);
  });

  it("returns error when thought is not found", async () => {
    mockGetVector.mockResolvedValue(null);

    const result = await handleDeleteThought({ id: THOUGHT_ID }, USER);

    expect(result).toBe(`Error: thought not found (id: ${THOUGHT_ID})`);
    expect(mockDeleteVector).not.toHaveBeenCalled();
  });

  it("returns permission error when thought belongs to another user", async () => {
    mockGetVector.mockResolvedValue(EXISTING_VECTOR);

    const result = await handleDeleteThought({ id: THOUGHT_ID }, OTHER_USER);

    expect(result).toBe("Error: you do not have permission to delete this thought");
    expect(mockDeleteVector).not.toHaveBeenCalled();
  });

  it("denies delete when existing thought has no user_id (secure default)", async () => {
    const noOwnerVector = {
      key: THOUGHT_ID,
      metadata: { content: "orphan thought" },
    };
    mockGetVector.mockResolvedValue(noOwnerVector);

    const result = await handleDeleteThought({ id: THOUGHT_ID }, USER);

    expect(result).toBe("Error: you do not have permission to delete this thought");
    expect(mockDeleteVector).not.toHaveBeenCalled();
  });
});
