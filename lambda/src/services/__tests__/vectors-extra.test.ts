import {
  resolveIndexes,
  buildMetadataFilter,
  ensurePrivateIndex,
} from "../vectors";
import { S3VectorsClient } from "@aws-sdk/client-s3vectors";

jest.mock("@aws-sdk/client-s3vectors", () => {
  const send = jest.fn();
  const Client = jest.fn(() => ({ send }));
  (Client as any).__mockSend = send;
  return {
    S3VectorsClient: Client,
    CreateIndexCommand: jest.fn((input: unknown) => ({ input })),
    QueryVectorsCommand: jest.fn((input: unknown) => ({ input })),
    PutVectorsCommand: jest.fn((input: unknown) => ({ input })),
    ListVectorsCommand: jest.fn((input: unknown) => ({ input })),
    GetVectorsCommand: jest.fn((input: unknown) => ({ input })),
    DeleteVectorsCommand: jest.fn((input: unknown) => ({ input })),
  };
});

const mockSend = (S3VectorsClient as any).__mockSend as jest.Mock;

beforeEach(() => {
  mockSend.mockReset();
});

describe("resolveIndexes", () => {
  it("returns private index for scope=private", () => {
    expect(resolveIndexes("user-123", "private")).toEqual(["private-user-123"]);
  });

  it("returns shared index for scope=shared", () => {
    expect(resolveIndexes("user-123", "shared")).toEqual(["shared"]);
  });

  it("returns both indexes for scope=all", () => {
    expect(resolveIndexes("user-123", "all")).toEqual(["private-user-123", "shared"]);
  });
});

describe("buildMetadataFilter", () => {
  it("returns undefined when no filters provided", () => {
    expect(buildMetadataFilter({})).toBeUndefined();
  });

  it("builds type filter", () => {
    expect(buildMetadataFilter({ type: "task" })).toEqual({ type: { $eq: "task" } });
  });

  it("builds topic filter", () => {
    expect(buildMetadataFilter({ topic: "work" })).toEqual({ topics: { $contains: "work" } });
  });

  it("builds userId filter", () => {
    expect(buildMetadataFilter({ userId: "user-123" })).toEqual({ user_id: { $eq: "user-123" } });
  });

  it("combines multiple filters with $and", () => {
    const filter = buildMetadataFilter({ type: "task", topic: "work" });
    expect(filter).toEqual({
      $and: [
        { type: { $eq: "task" } },
        { topics: { $contains: "work" } },
      ],
    });
  });
});

describe("ensurePrivateIndex", () => {
  it("creates index and returns index name", async () => {
    
    mockSend.mockResolvedValue({});

    const result = await ensurePrivateIndex("user-new");
    expect(result).toBe("private-user-new");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("ignores ConflictException (index already exists)", async () => {
    
    const err = Object.assign(new Error("conflict"), { name: "ConflictException" });
    mockSend.mockRejectedValue(err);

    await expect(ensurePrivateIndex("user-existing")).resolves.toBe("private-user-existing");
  });

  it("re-throws non-conflict errors", async () => {
    
    const err = Object.assign(new Error("access denied"), { name: "AccessDeniedException" });
    mockSend.mockRejectedValue(err);

    await expect(ensurePrivateIndex("user-bad")).rejects.toThrow("access denied");
  });

  it("skips CreateIndex call when index is already in the known set (shared)", async () => {
    
    // 'shared' is pre-seeded in knownIndexes — ensurePrivateIndex is for private only,
    // but we can test the cache by calling with the same userId twice
    mockSend.mockResolvedValue({});
    await ensurePrivateIndex("user-cached");
    await ensurePrivateIndex("user-cached");

    // Second call should be skipped (cached), so send called only once
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
