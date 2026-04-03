import {
  S3VectorsClient,
  DeleteIndexCommand,
} from "@aws-sdk/client-s3vectors";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { UserContext } from "../types";

// Read env vars lazily inside functions so module-level constants
// don't capture undefined values before tests set process.env.
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const vectorsClient = new S3VectorsClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

export async function handleDeleteAccount(user: UserContext): Promise<void> {
  const { userId, cognitoUsername } = user;

  await Promise.all([
    deletePrivateVectorIndex(userId),
    deleteByPkSk(env("AGENT_KEYS_TABLE"), "pk", `USER#${userId}`, "sk"),
    deleteByPk(env("AGENT_TASKS_TABLE"), "userId", userId, "taskId"),
    deleteByGsi(env("GOOGLE_CONNECTIONS_TABLE"), "userId", userId, "userId", "email"),
    deleteByGsi(
      env("GITHUB_INSTALLATIONS_TABLE"),
      "user-id-index",
      userId,
      "installationId",
      undefined,
      "userId"
    ),
    deleteSlackInstallations(userId),
  ]);

  // Delete Cognito user last — this invalidates the token used for the request.
  // cognitoUsername (from `cognito:username` JWT claim) is the correct identifier
  // for federated users (e.g., "Google_12345"); fall back to sub if not present.
  await cognito.send(
    new AdminDeleteUserCommand({
      UserPoolId: env("USER_POOL_ID"),
      Username: cognitoUsername ?? userId,
    })
  );
}

// ---------------------------------------------------------------------------
// S3 Vectors
// ---------------------------------------------------------------------------

async function deletePrivateVectorIndex(userId: string): Promise<void> {
  try {
    await vectorsClient.send(
      new DeleteIndexCommand({
        vectorBucketName: env("VECTOR_BUCKET_NAME"),
        indexName: `private-${userId}`,
      })
    );
  } catch (e: any) {
    if (e.name !== "NotFoundException") throw e;
  }
}

// ---------------------------------------------------------------------------
// DynamoDB helpers — all paginate and retry UnprocessedItems
// ---------------------------------------------------------------------------

/**
 * Delete all items where the partition key equals `pkValue`.
 * Used for tables whose PK is a plain userId (agent-tasks, google-connections).
 */
async function deleteByPk(
  table: string,
  pkAttr: string,
  pkValue: string,
  skAttr: string
): Promise<void> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "#pk = :v",
        ExpressionAttributeNames: { "#pk": pkAttr },
        ExpressionAttributeValues: { ":v": pkValue },
        ProjectionExpression: `${pkAttr}, ${skAttr}`,
        ExclusiveStartKey: lastKey,
      })
    );
    await batchDelete(table, (result.Items ?? []).map((item) => ({ [pkAttr]: item[pkAttr], [skAttr]: item[skAttr] })));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
}

/**
 * Delete all items where pk = `USER#{userId}` (agent-keys pattern).
 */
async function deleteByPkSk(
  table: string,
  pkAttr: string,
  pkValue: string,
  skAttr: string
): Promise<void> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "#pk = :v",
        ExpressionAttributeNames: { "#pk": pkAttr },
        ExpressionAttributeValues: { ":v": pkValue },
        ProjectionExpression: `${pkAttr}, ${skAttr}`,
        ExclusiveStartKey: lastKey,
      })
    );
    await batchDelete(table, (result.Items ?? []).map((item) => ({ [pkAttr]: item[pkAttr], [skAttr]: item[skAttr] })));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
}

/**
 * Delete all items found via a GSI query.
 * `tableKeyAttr` / `tableSortAttr` are the *table* primary key attrs (needed for delete).
 * `gsiKeyAttr` is the GSI partition key attribute to filter on.
 */
async function deleteByGsi(
  table: string,
  indexName: string,
  userId: string,
  tableKeyAttr: string,
  tableSortAttr: string | undefined,
  gsiKeyAttr: string = "userId"
): Promise<void> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: indexName,
        KeyConditionExpression: "#gk = :v",
        ExpressionAttributeNames: { "#gk": gsiKeyAttr },
        ExpressionAttributeValues: { ":v": userId },
        ProjectionExpression: tableSortAttr
          ? `${tableKeyAttr}, ${tableSortAttr}`
          : tableKeyAttr,
        ExclusiveStartKey: lastKey,
      })
    );
    const keys = (result.Items ?? []).map((item) =>
      tableSortAttr
        ? { [tableKeyAttr]: item[tableKeyAttr], [tableSortAttr]: item[tableSortAttr] }
        : { [tableKeyAttr]: item[tableKeyAttr] }
    );
    await batchDelete(table, keys);
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
}

/**
 * Slack installations: pk=teamId, sk=userId — the GSI returns both, so we can
 * build the full delete key directly.
 */
async function deleteSlackInstallations(userId: string): Promise<void> {
  const table = env("SLACK_INSTALLATIONS_TABLE");
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: "user-id-index",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId },
        ProjectionExpression: "teamId, userId",
        ExclusiveStartKey: lastKey,
      })
    );
    await batchDelete(
      table,
      (result.Items ?? []).map((item) => ({ teamId: item.teamId, userId: item.userId }))
    );
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
}

/**
 * BatchWriteItem with UnprocessedItems retry (exponential backoff, up to 5 attempts).
 */
async function batchDelete(
  table: string,
  keys: Record<string, unknown>[]
): Promise<void> {
  if (keys.length === 0) return;

  for (let i = 0; i < keys.length; i += 25) {
    let unprocessed: typeof keys = keys.slice(i, i + 25);
    let attempt = 0;

    while (unprocessed.length > 0) {
      const result = await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [table]: unprocessed.map((key) => ({ DeleteRequest: { Key: key } })),
          },
        })
      );

      const remaining = result.UnprocessedItems?.[table];
      if (!remaining || remaining.length === 0) break;

      attempt++;
      if (attempt >= 5) {
        throw new Error(`BatchWriteItem: ${remaining.length} items unprocessed after 5 attempts (table: ${table})`);
      }

      unprocessed = remaining.map((r) => r.DeleteRequest!.Key as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }
}
