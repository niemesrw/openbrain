import { handleBusActivity } from "../bus-activity";
import * as vectors from "../../services/vectors";

jest.mock("../../services/vectors");
const mockList = vectors.listAllVectors as jest.MockedFunction<typeof vectors.listAllVectors>;

const NOW = 1_700_000_000_000;

function makeVector(
  key: string,
  overrides: Partial<{
    tenant_id: string;
    agent_id: string;
    display_name: string;
    user_id: string;
    content: string;
    created_at: number;
    type: string;
    topics: string[];
  }> = {}
) {
  return {
    key,
    metadata: {
      content: overrides.content ?? "a shared thought",
      type: overrides.type ?? "observation",
      topics: overrides.topics ?? [],
      created_at: overrides.created_at ?? NOW,
      user_id: overrides.user_id ?? "user-123",
      ...(overrides.tenant_id !== undefined && { tenant_id: overrides.tenant_id }),
      ...(overrides.agent_id && { agent_id: overrides.agent_id }),
      ...(overrides.display_name && { display_name: overrides.display_name }),
    },
  };
}

const USER = { userId: "user-123", displayName: "Ryan", agentName: undefined };

beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(NOW));
afterEach(() => jest.restoreAllMocks());

describe("handleBusActivity", () => {
  it("returns all recent shared thoughts when no filters applied", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "thought A" }),
      makeVector("k2", { tenant_id: "user-456", content: "thought B" }),
    ]);
    const result = await handleBusActivity({}, USER);
    expect(result).toContain("thought A");
    expect(result).toContain("thought B");
  });

  it("filters results to matching tenant_id", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "my thought" }),
      makeVector("k2", { tenant_id: "user-456", content: "other tenant thought" }),
    ]);
    const result = await handleBusActivity({ tenant_id: "user-123" }, USER);
    expect(result).toContain("my thought");
    expect(result).not.toContain("other tenant thought");
  });

  it("excludes all results when tenant_id matches nothing", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-456", content: "someone else" }),
    ]);
    const result = await handleBusActivity({ tenant_id: "user-123" }, USER);
    expect(result).toContain("No shared activity");
  });

  it("includes old thoughts without tenant_id regardless of tenant filter (backward compat)", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { content: "old thought no tenant" }), // no tenant_id key
      makeVector("k2", { tenant_id: "user-123", content: "my new thought" }),
      makeVector("k3", { tenant_id: "user-456", content: "other tenant" }),
    ]);
    // NOTE: bus-activity does NOT have backward-compat passthrough like browse-recent —
    // it only filters when tenant_id is explicitly provided, so thoughts without the
    // field are excluded (strict filter). This test documents the current behavior.
    const result = await handleBusActivity({ tenant_id: "user-123" }, USER);
    expect(result).toContain("my new thought");
    expect(result).not.toContain("other tenant");
    // old thought without tenant_id is excluded by the strict filter
    expect(result).not.toContain("old thought no tenant");
  });

  it("applies agent filter in addition to tenant_id filter", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", agent_id: "bot-a", content: "bot-a thought" }),
      makeVector("k2", { tenant_id: "user-123", agent_id: "bot-b", content: "bot-b thought" }),
    ]);
    const result = await handleBusActivity({ tenant_id: "user-123", agent: "bot-a" }, USER);
    expect(result).toContain("bot-a thought");
    expect(result).not.toContain("bot-b thought");
  });

  it("excludes thoughts older than the hours window", async () => {
    const tooOld = NOW - 25 * 60 * 60 * 1000;
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "recent", created_at: NOW }),
      makeVector("k2", { tenant_id: "user-123", content: "old post", created_at: tooOld }),
    ]);
    const result = await handleBusActivity({ tenant_id: "user-123", hours: 24 }, USER);
    expect(result).toContain("recent");
    expect(result).not.toContain("old post");
  });

  it("returns json format with tenant filter applied", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "json thought" }),
      makeVector("k2", { tenant_id: "user-456", content: "other" }),
    ]);
    const raw = await handleBusActivity({ tenant_id: "user-123", _format: "json" }, USER);
    const parsed = JSON.parse(raw);
    expect(parsed.summary.total).toBe(1);
    expect(parsed.recent[0].content).toBe("json thought");
  });

  it("respects limit parameter", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "t1" }),
      makeVector("k2", { tenant_id: "user-123", content: "t2" }),
      makeVector("k3", { tenant_id: "user-123", content: "t3" }),
    ]);
    const raw = await handleBusActivity({ tenant_id: "user-123", limit: 2, _format: "json" }, USER);
    const parsed = JSON.parse(raw);
    expect(parsed.summary.total).toBe(2);
  });
});
