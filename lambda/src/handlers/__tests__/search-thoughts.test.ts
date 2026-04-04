import { handleSearchThoughts } from "../search-thoughts";
import * as vectors from "../../services/vectors";
import * as embeddings from "../../services/embeddings";

jest.mock("../../services/vectors");
jest.mock("../../services/embeddings");

const mockGenerateEmbedding = embeddings.generateEmbedding as jest.MockedFunction<typeof embeddings.generateEmbedding>;
const mockResolveIndexes = vectors.resolveIndexes as jest.MockedFunction<typeof vectors.resolveIndexes>;
const mockQueryVectors = vectors.queryVectors as jest.MockedFunction<typeof vectors.queryVectors>;
const mockBuildMetadataFilter = vectors.buildMetadataFilter as jest.MockedFunction<typeof vectors.buildMetadataFilter>;

const USER = { userId: "user-123" };
const EMBEDDING = [0.1, 0.2, 0.3];

const makeVector = (key: string, content: string, distance = 0.2, tenantId?: string) => ({
  key,
  distance,
  metadata: {
    content,
    type: "observation",
    topics: ["work"],
    created_at: 1700000000000,
    action_items: "[]",
    dates_mentioned: "[]",
    ...(tenantId !== undefined && { tenant_id: tenantId }),
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateEmbedding.mockResolvedValue(EMBEDDING);
  mockResolveIndexes.mockReturnValue(["private-user-123"]);
  mockBuildMetadataFilter.mockReturnValue(undefined);
  mockQueryVectors.mockResolvedValue([]);
});

describe("handleSearchThoughts", () => {
  it("returns no results message when nothing found", async () => {
    const result = await handleSearchThoughts({ query: "nothing here" }, USER);
    expect(result).toBe("No matching thoughts found. Try lowering the threshold.");
  });

  it("returns formatted results for matching thoughts", async () => {
    mockQueryVectors.mockResolvedValue([makeVector("id-1", "Had a great meeting", 0.2)]);

    const result = await handleSearchThoughts({ query: "meeting" }, USER);

    expect(result).toContain("Found 1 thought(s)");
    expect(result).toContain("Had a great meeting");
    expect(result).toContain("observation");
  });

  it("filters out results below threshold", async () => {
    // distance 1.5 → similarity = 1 - 1.5/2 = 0.25, below default threshold of 0.5
    mockQueryVectors.mockResolvedValue([makeVector("id-1", "Irrelevant", 1.5)]);

    const result = await handleSearchThoughts({ query: "meeting" }, USER);

    expect(result).toBe("No matching thoughts found. Try lowering the threshold.");
  });

  it("sorts results by distance ascending (most similar first)", async () => {
    mockQueryVectors.mockResolvedValue([
      makeVector("id-far", "Less relevant", 0.6),
      makeVector("id-near", "Very relevant", 0.1),
    ]);

    const result = await handleSearchThoughts({ query: "relevant" }, USER);

    expect(result.indexOf("Very relevant")).toBeLessThan(result.indexOf("Less relevant"));
  });

  it("returns JSON format when _format=json", async () => {
    mockQueryVectors.mockResolvedValue([makeVector("id-1", "A thought", 0.2)]);

    const result = await handleSearchThoughts({ query: "thought", _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.thoughts).toHaveLength(1);
    expect(parsed.thoughts[0]).toMatchObject({
      id: "id-1",
      content: "A thought",
      type: "observation",
      similarity: expect.any(Number),
    });
  });

  it("returns empty JSON array when no results and _format=json", async () => {
    const result = await handleSearchThoughts({ query: "nothing", _format: "json" }, USER);
    const parsed = JSON.parse(result);
    expect(parsed.thoughts).toEqual([]);
  });

  it("queries both indexes for scope=all", async () => {
    mockResolveIndexes.mockReturnValue(["private-user-123", "shared"]);
    mockQueryVectors.mockResolvedValue([]);

    await handleSearchThoughts({ query: "test", scope: "all" }, USER);

    expect(mockQueryVectors).toHaveBeenCalledTimes(2);
  });

  it("tags results with correct scope in JSON output", async () => {
    mockResolveIndexes.mockReturnValue(["private-user-123"]);
    mockQueryVectors.mockResolvedValue([makeVector("id-1", "Private thought", 0.1)]);

    const result = await handleSearchThoughts({ query: "thought", _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.thoughts[0].scope).toBe("private");
  });

  it("passes type and topic filters to buildMetadataFilter", async () => {
    await handleSearchThoughts({ query: "test", type: "task", topic: "work" }, USER);

    expect(mockBuildMetadataFilter).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task", topic: "work" })
    );
  });

  it("filters out shared results from other tenants (server-enforced tenant isolation)", async () => {
    mockResolveIndexes.mockReturnValue(["shared"]);
    mockQueryVectors.mockResolvedValue([
      makeVector("id-mine", "my shared thought", 0.1, "user-123"),
      makeVector("id-theirs", "other user thought", 0.1, "user-456"),
    ]);

    const result = await handleSearchThoughts({ query: "thought", scope: "shared" }, USER);

    expect(result).toContain("my shared thought");
    expect(result).not.toContain("other user thought");
  });

  it("includes old shared thoughts without tenant_id (backward compat)", async () => {
    mockResolveIndexes.mockReturnValue(["shared"]);
    mockQueryVectors.mockResolvedValue([
      makeVector("id-old", "old thought no tenant", 0.1),
      makeVector("id-mine", "my new thought", 0.1, "user-123"),
      makeVector("id-theirs", "other user thought", 0.1, "user-456"),
    ]);

    const result = await handleSearchThoughts({ query: "thought", scope: "shared" }, USER);

    expect(result).toContain("old thought no tenant");
    expect(result).toContain("my new thought");
    expect(result).not.toContain("other user thought");
  });

  it("does not apply tenant filter to private index results", async () => {
    mockResolveIndexes.mockReturnValue(["private-user-123"]);
    mockQueryVectors.mockResolvedValue([
      makeVector("id-1", "private thought no tenant", 0.1),
    ]);

    const result = await handleSearchThoughts({ query: "thought" }, USER);

    expect(result).toContain("private thought no tenant");
  });

  it("includes media_url in JSON response when vector metadata contains it", async () => {
    const vectorWithMedia = {
      ...makeVector("id-media", "A thought with an image", 0.2),
      metadata: {
        ...makeVector("id-media", "A thought with an image", 0.2).metadata,
        media_url: "https://example.com/image.png",
      },
    };
    mockQueryVectors.mockResolvedValue([vectorWithMedia]);

    const result = await handleSearchThoughts({ query: "image", _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.thoughts[0].media_url).toBe("https://example.com/image.png");
  });

  it("omits media_url from JSON response when vector metadata does not contain it", async () => {
    mockQueryVectors.mockResolvedValue([makeVector("id-1", "A thought without media", 0.2)]);

    const result = await handleSearchThoughts({ query: "thought", _format: "json" }, USER);
    const parsed = JSON.parse(result);

    expect(parsed.thoughts[0]).not.toHaveProperty("media_url");
  });

  it("truncates query exceeding 2,000 characters before generating embedding", async () => {
    const longQuery = "x".repeat(3_000);

    await handleSearchThoughts({ query: longQuery }, USER);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith("x".repeat(2_000));
  });

  it("passes query unchanged when within 2,000 character limit", async () => {
    const shortQuery = "short query";

    await handleSearchThoughts({ query: shortQuery }, USER);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(shortQuery);
  });
});
