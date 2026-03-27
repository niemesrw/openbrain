import {
  S3VectorsClient,
  CreateIndexCommand,
  QueryVectorsCommand,
  PutVectorsCommand,
  ListVectorsCommand,
  GetVectorsCommand,
  DeleteVectorsCommand,
} from "@aws-sdk/client-s3vectors";

const client = new S3VectorsClient({});
const VECTOR_BUCKET = process.env.VECTOR_BUCKET_NAME!;

const knownIndexes = new Set<string>(["shared"]);

export async function ensurePrivateIndex(userId: string): Promise<string> {
  const indexName = `private-${userId}`;
  if (knownIndexes.has(indexName)) return indexName;

  try {
    await client.send(
      new CreateIndexCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName,
        dataType: "float32",
        dimension: 1024,
        distanceMetric: "cosine",
        metadataConfiguration: {
          nonFilterableMetadataKeys: [
            "content",
            "action_items",
            "dates_mentioned",
          ],
        },
      })
    );
  } catch (e: any) {
    // Index already exists — that's fine
    if (e.name !== "ConflictException") throw e;
  }

  knownIndexes.add(indexName);
  return indexName;
}

export function resolveIndexes(
  userId: string,
  scope: "private" | "shared" | "all"
): string[] {
  switch (scope) {
    case "private":
      return [`private-${userId}`];
    case "shared":
      return ["shared"];
    case "all":
      return [`private-${userId}`, "shared"];
  }
}

export interface VectorMetadata {
  type?: string;
  topics?: string[];
  people?: string[];
  user_id?: string;
  created_at?: number;
  content?: string;
  action_items?: string;
  dates_mentioned?: string;
  display_name?: string;
  agent_id?: string;
  /** Tenant identifier — set on all shared captures for multi-tenant filtering */
  tenant_id?: string;
}

export async function queryVectors(
  indexName: string,
  embedding: number[],
  topK: number,
  filter?: Record<string, any>
) {
  try {
    const result = await client.send(
      new QueryVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName,
        queryVector: { float32: embedding },
        topK,
        ...(filter ? { filter } : {}),
        returnMetadata: true,
        returnDistance: true,
      })
    );
    return result.vectors ?? [];
  } catch (e: any) {
    // Private index doesn't exist yet — user hasn't captured anything
    if (e.name === "NotFoundException") return [];
    throw e;
  }
}

export async function putVector(
  indexName: string,
  key: string,
  embedding: number[],
  metadata: VectorMetadata
) {
  await client.send(
    new PutVectorsCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName,
      vectors: [
        {
          key,
          data: { float32: embedding },
          metadata: metadata as Record<string, any>,
        },
      ],
    })
  );
}

// Fetches all vectors with metadata from an index. Fine for personal-scale use
// (hundreds to low thousands of thoughts). At 10K+ thoughts, consider adding
// pagination limits or a secondary index for chronological access.
export async function listAllVectors(
  indexName: string
): Promise<{ key: string; metadata: VectorMetadata }[]> {
  const all: { key: string; metadata: VectorMetadata }[] = [];
  let nextToken: string | undefined;

  try {
    do {
      const result = await client.send(
        new ListVectorsCommand({
          vectorBucketName: VECTOR_BUCKET,
          indexName,
          returnMetadata: true,
          ...(nextToken ? { nextToken } : {}),
        })
      );

      for (const v of result.vectors ?? []) {
        all.push({
          key: v.key!,
          metadata: (v.metadata ?? {}) as VectorMetadata,
        });
      }

      nextToken = result.nextToken;
    } while (nextToken);
  } catch (e: any) {
    // Private index doesn't exist yet — user hasn't captured anything
    if (e.name === "NotFoundException") return [];
    throw e;
  }

  return all;
}

export async function getVector(
  indexName: string,
  key: string
): Promise<{ key: string; metadata: VectorMetadata } | null> {
  try {
    const result = await client.send(
      new GetVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName,
        keys: [key],
        returnMetadata: true,
      })
    );
    const vector = result.vectors?.[0];
    if (!vector) return null;
    return {
      key: vector.key!,
      metadata: (vector.metadata ?? {}) as VectorMetadata,
    };
  } catch (e: any) {
    if (e.name === "NotFoundException") return null;
    throw e;
  }
}

export async function deleteVector(
  indexName: string,
  key: string
): Promise<void> {
  await client.send(
    new DeleteVectorsCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName,
      keys: [key],
    })
  );
}

export function buildMetadataFilter(args: {
  type?: string;
  topic?: string;
  userId?: string;
}): Record<string, any> | undefined {
  const conditions: Record<string, any>[] = [];

  if (args.type) {
    conditions.push({ "type": { "$eq": args.type } });
  }
  if (args.topic) {
    conditions.push({ "topics": { "$contains": args.topic } });
  }
  if (args.userId) {
    conditions.push({ "user_id": { "$eq": args.userId } });
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { "$and": conditions };
}
