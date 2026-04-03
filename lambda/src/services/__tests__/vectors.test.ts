process.env.VECTOR_BUCKET_NAME = "test-bucket";

// Define the mock send function inside the factory so it's always initialized.
// We expose it via a custom property on the mock constructor for test access.
jest.mock("@aws-sdk/client-s3vectors", () => {
  const mockSend = jest.fn();
  const MockS3VectorsClient = jest.fn().mockImplementation(() => ({ send: mockSend }));
  (MockS3VectorsClient as any).__mockSend = mockSend;
  return {
    S3VectorsClient: MockS3VectorsClient,
    GetVectorsCommand: jest.fn((params: unknown) => params),
    DeleteVectorsCommand: jest.fn((params: unknown) => params),
    CreateIndexCommand: jest.fn((params: unknown) => params),
    PutVectorsCommand: jest.fn((params: unknown) => params),
    QueryVectorsCommand: jest.fn((params: unknown) => params),
    ListVectorsCommand: jest.fn((params: unknown) => params),
  };
});

import { S3VectorsClient } from "@aws-sdk/client-s3vectors";
import { getVector, deleteVector } from "../vectors";

const mockSend = (S3VectorsClient as any).__mockSend as jest.Mock;

beforeEach(() => {
  mockSend.mockReset();
});

describe("getVector", () => {
  it("returns key and metadata when vector is found", async () => {
    mockSend.mockResolvedValue({
      vectors: [
        {
          key: "vec-1",
          metadata: { user_id: "user-123", content: "some thought", type: "idea" },
        },
      ],
    });

    const result = await getVector("private-user-123", "vec-1");

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      key: "vec-1",
      metadata: { user_id: "user-123", content: "some thought", type: "idea" },
    });
  });

  it("returns null when vectors array is empty", async () => {
    mockSend.mockResolvedValue({ vectors: [] });

    const result = await getVector("private-user-123", "missing-vec");

    expect(result).toBeNull();
  });

  it("returns null when NotFoundException is thrown (index does not exist)", async () => {
    const err = new Error("Index not found");
    (err as any).name = "NotFoundException";
    mockSend.mockRejectedValue(err);

    const result = await getVector("private-user-123", "any-key");

    expect(result).toBeNull();
  });

  it("re-throws unexpected errors", async () => {
    const err = new Error("ServiceUnavailable");
    (err as any).name = "ServiceUnavailableException";
    mockSend.mockRejectedValue(err);

    await expect(getVector("private-user-123", "any-key")).rejects.toThrow(
      "ServiceUnavailable"
    );
  });
});

describe("deleteVector", () => {
  it("calls DeleteVectorsCommand with correct bucket, index, and key", async () => {
    mockSend.mockResolvedValue({});

    await deleteVector("private-user-123", "vec-to-delete");

    expect(mockSend).toHaveBeenCalledTimes(1);
    // The command constructor is mocked as an identity function, so the arg
    // passed to send is the raw params object.
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg).toMatchObject({
      vectorBucketName: "test-bucket",
      indexName: "private-user-123",
      keys: ["vec-to-delete"],
    });
  });

  it("resolves without error on success", async () => {
    mockSend.mockResolvedValue({});

    await expect(deleteVector("shared", "vec-1")).resolves.toBeUndefined();
  });

  it("propagates errors from the SDK", async () => {
    mockSend.mockRejectedValue(new Error("access denied"));

    await expect(deleteVector("shared", "vec-1")).rejects.toThrow("access denied");
  });
});
