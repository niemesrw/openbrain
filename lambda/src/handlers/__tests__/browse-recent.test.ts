import { handleBrowseRecent } from "../browse-recent";
import * as vectors from "../../services/vectors";

jest.mock("../../services/vectors");

const mockListAllVectors = vectors.listAllVectors as jest.MockedFunction<
  typeof vectors.listAllVectors
>;
const mockResolveIndexes = vectors.resolveIndexes as jest.MockedFunction<
  typeof vectors.resolveIndexes
>;

const USER = { userId: "user-123" };
const NOW = 1_743_000_000_000;

function makeVector(
  key: string,
  overrides: Partial<{ type: string; topics: string[]; tenant_id: string; created_at: number; content: string }>
) {
  return {
    key,
    metadata: {
      type: overrides.type ?? "idea",
      topics: overrides.topics ?? [],
      user_id: "user-123",
      created_at: overrides.created_at ?? NOW,
      content: overrides.content ?? "some thought",
      action_items: "[]",
      dates_mentioned: "[]",
      ...(overrides.tenant_id && { tenant_id: overrides.tenant_id }),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveIndexes.mockImplementation((userId, scope) => {
    if (scope === "shared") return ["shared"];
    if (scope === "all") return [`private-${userId}`, "shared"];
    return [`private-${userId}`];
  });
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("handleBrowseRecent", () => {
  it("returns private thoughts for default scope", async () => {
    mockListAllVectors.mockResolvedValue([makeVector("k1", { content: "my thought" })]);

    const result = await handleBrowseRecent({}, USER);

    expect(mockResolveIndexes).toHaveBeenCalledWith(USER.userId, "private");
    expect(result).toContain("my thought");
  });

  it("filters by type", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { type: "idea", content: "idea content" }),
      makeVector("k2", { type: "task", content: "task content" }),
    ]);

    const result = await handleBrowseRecent({ type: "idea" }, USER);

    expect(result).toContain("idea content");
    expect(result).not.toContain("task content");
  });

  it("filters by topic", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { topics: ["aws"], content: "aws thought" }),
      makeVector("k2", { topics: ["react"], content: "react thought" }),
    ]);

    const result = await handleBrowseRecent({ topic: "aws" }, USER);

    expect(result).toContain("aws thought");
    expect(result).not.toContain("react thought");
  });

  it("filters shared results by tenant_id when provided", async () => {
    mockResolveIndexes.mockReturnValue(["shared"]);
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "my shared thought" }),
      makeVector("k2", { tenant_id: "user-456", content: "other user thought" }),
    ]);

    // Simulate: scope=shared, list all, then filter to tenant_id=user-123
    // The handler passes _indexName as the shared index, so private check won't match
    // We need to use scope=shared here
    const result = await handleBrowseRecent(
      { scope: "shared", tenant_id: "user-123" },
      USER
    );

    expect(result).toContain("my shared thought");
    expect(result).not.toContain("other user thought");
  });

  it("does not filter private index by tenant_id (own thoughts always shown)", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { content: "private thought no tenant" }),
    ]);

    const result = await handleBrowseRecent(
      { scope: "private", tenant_id: "user-123" },
      USER
    );

    // Private index results pass through even without tenant_id in metadata
    expect(result).toContain("private thought no tenant");
  });

  it("includes old shared thoughts without tenant_id when filtering (backward compat)", async () => {
    mockResolveIndexes.mockReturnValue(["shared"]);
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { content: "old shared thought" }), // no tenant_id — pre-feature
      makeVector("k2", { content: "new shared mine", tenant_id: "user-123" }),
      makeVector("k3", { content: "other user thought", tenant_id: "user-456" }),
    ]);

    const result = await handleBrowseRecent(
      { scope: "shared", tenant_id: "user-123" },
      USER
    );

    expect(result).toContain("old shared thought");
    expect(result).toContain("new shared mine");
    expect(result).not.toContain("other user thought");
  });

  it("filters correctly with scope=all and tenant_id", async () => {
    mockResolveIndexes.mockReturnValue([`private-${USER.userId}`, "shared"]);
    mockListAllVectors
      .mockResolvedValueOnce([makeVector("k1", { content: "private thought" })])
      .mockResolvedValueOnce([
        makeVector("k2", { content: "shared mine", tenant_id: "user-123" }),
        makeVector("k3", { content: "shared other", tenant_id: "user-456" }),
      ]);

    const result = await handleBrowseRecent(
      { scope: "all", tenant_id: "user-123" },
      USER
    );

    expect(result).toContain("private thought");
    expect(result).toContain("shared mine");
    expect(result).not.toContain("shared other");
  });


  it("excludes agent-sourced thoughts when human_only=true", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { content: "my own thought" }),
      { key: "k2", metadata: { ...makeVector("k2", { content: "github commit" }).metadata, source: "github" } },
    ]);

    const result = await handleBrowseRecent({ human_only: true }, USER);

    expect(result).toContain("my own thought");
    expect(result).not.toContain("github commit");
  });

  it("includes agent-sourced thoughts when human_only is not set", async () => {
    mockListAllVectors.mockResolvedValue([
      makeVector("k1", { content: "my own thought" }),
      { key: "k2", metadata: { ...makeVector("k2", { content: "github commit" }).metadata, source: "github" } },
    ]);

    const result = await handleBrowseRecent({}, USER);

    expect(result).toContain("my own thought");
    expect(result).toContain("github commit");
  });

  it("includes source in JSON response when present", async () => {
    mockListAllVectors.mockResolvedValue([
      { key: "k1", metadata: { ...makeVector("k1", { content: "github commit" }).metadata, source: "github" } },
    ]);

    const raw = await handleBrowseRecent({ _format: "json" }, USER);
    const parsed = JSON.parse(raw);

    expect(parsed.thoughts[0].source).toBe("github");
  });

  it("omits source from JSON response when not set", async () => {
    mockListAllVectors.mockResolvedValue([makeVector("k1", { content: "user thought" })]);

    const raw = await handleBrowseRecent({ _format: "json" }, USER);
    const parsed = JSON.parse(raw);

    expect(parsed.thoughts[0]).not.toHaveProperty("source");
  });

  it("returns no thoughts message when empty", async () => {
    mockListAllVectors.mockResolvedValue([]);

    const result = await handleBrowseRecent({}, USER);

    expect(result).toBe("No thoughts found.");
  });

  it("returns json when _format=json", async () => {
    mockListAllVectors.mockResolvedValue([makeVector("k1", {})]);

    const raw = await handleBrowseRecent({ _format: "json" }, USER);
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty("thoughts");
    expect(Array.isArray(parsed.thoughts)).toBe(true);
  });

  it("respects limit", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeVector(`k${i}`, { created_at: NOW - i * 1000 })
    );
    mockListAllVectors.mockResolvedValue(many);

    const raw = await handleBrowseRecent({ limit: 5, _format: "json" }, USER);
    const parsed = JSON.parse(raw);

    expect(parsed.thoughts).toHaveLength(5);
  });

  it("includes media_url in JSON response when vector metadata contains it", async () => {
    const vectorWithMedia = {
      key: "k-media",
      metadata: {
        ...makeVector("k-media", {}).metadata,
        media_url: "https://example.com/image.png",
      },
    };
    mockListAllVectors.mockResolvedValue([vectorWithMedia]);

    const raw = await handleBrowseRecent({ _format: "json" }, USER);
    const parsed = JSON.parse(raw);

    expect(parsed.thoughts[0].media_url).toBe("https://example.com/image.png");
  });

  it("omits media_url from JSON response when vector metadata does not contain it", async () => {
    mockListAllVectors.mockResolvedValue([makeVector("k1", { content: "no media thought" })]);

    const raw = await handleBrowseRecent({ _format: "json" }, USER);
    const parsed = JSON.parse(raw);

    expect(parsed.thoughts[0]).not.toHaveProperty("media_url");
  });
});
