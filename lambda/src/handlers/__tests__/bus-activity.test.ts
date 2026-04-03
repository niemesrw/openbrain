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
  it("returns only the authenticated user's shared thoughts (server-enforced tenant isolation)", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "thought A" }),
      makeVector("k2", { tenant_id: "user-456", content: "thought B" }),
    ]);
    const result = await handleBusActivity({}, USER);
    expect(result).toContain("thought A");
    expect(result).not.toContain("thought B");
  });

  it("cannot be bypassed by omitting tenant_id arg (bypass prevention)", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "my thought" }),
      makeVector("k2", { tenant_id: "user-456", content: "other tenant thought" }),
    ]);
    // No tenant_id arg — server must still scope to user.userId
    const result = await handleBusActivity({}, USER);
    expect(result).toContain("my thought");
    expect(result).not.toContain("other tenant thought");
  });

  it("filters results to authenticated user's tenant (caller-supplied tenant_id is ignored)", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "my thought" }),
      makeVector("k2", { tenant_id: "user-456", content: "other tenant thought" }),
    ]);
    // Even if caller passes a different tenant_id, server enforces user.userId
    const result = await handleBusActivity({ tenant_id: "user-456" }, USER);
    expect(result).toContain("my thought");
    expect(result).not.toContain("other tenant thought");
  });

  it("excludes all results when no thoughts match the authenticated user's tenant", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-456", content: "someone else" }),
    ]);
    const result = await handleBusActivity({}, USER);
    expect(result).toContain("No shared activity");
  });

  it("old thoughts without tenant_id are excluded (strict filter)", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { content: "old thought no tenant" }), // no tenant_id key
      makeVector("k2", { tenant_id: "user-123", content: "my new thought" }),
      makeVector("k3", { tenant_id: "user-456", content: "other tenant" }),
    ]);
    const result = await handleBusActivity({}, USER);
    expect(result).toContain("my new thought");
    expect(result).not.toContain("other tenant");
    // old thought without tenant_id is excluded by the strict filter
    expect(result).not.toContain("old thought no tenant");
  });

  it("applies agent filter in addition to tenant enforcement", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", agent_id: "bot-a", content: "bot-a thought" }),
      makeVector("k2", { tenant_id: "user-123", agent_id: "bot-b", content: "bot-b thought" }),
    ]);
    const result = await handleBusActivity({ agent: "bot-a" }, USER);
    expect(result).toContain("bot-a thought");
    expect(result).not.toContain("bot-b thought");
  });

  it("excludes thoughts older than the hours window", async () => {
    const tooOld = NOW - 25 * 60 * 60 * 1000;
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "recent", created_at: NOW }),
      makeVector("k2", { tenant_id: "user-123", content: "old post", created_at: tooOld }),
    ]);
    const result = await handleBusActivity({ hours: 24 }, USER);
    expect(result).toContain("recent");
    expect(result).not.toContain("old post");
  });

  it("returns json format with tenant filter applied", async () => {
    mockList.mockResolvedValue([
      makeVector("k1", { tenant_id: "user-123", content: "json thought" }),
      makeVector("k2", { tenant_id: "user-456", content: "other" }),
    ]);
    const raw = await handleBusActivity({ _format: "json" }, USER);
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
    const raw = await handleBusActivity({ limit: 2, _format: "json" }, USER);
    const parsed = JSON.parse(raw);
    expect(parsed.summary.total).toBe(2);
  });
});
