import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

let client: DynamoDBClient | undefined;
function getClient(): DynamoDBClient {
  if (!client) client = new DynamoDBClient({});
  return client;
}

const parsed = Number(process.env.FREE_TIER_DAILY_LIMIT ?? "50");
const FREE_TIER_DAILY_LIMIT = Number.isFinite(parsed) && parsed >= 1 ? parsed : 50;

/**
 * Atomically increment the daily capture count for a user and enforce the free
 * tier limit.  Uses a conditional update so the counter never exceeds the cap.
 *
 * Records live in the agent-keys table with:
 *   pk = USER#{userId}   sk = USAGE#{YYYY-MM-DD}
 *
 * We increment BEFORE the capture work (embedding, metadata, vector write)
 * intentionally — the daily cap exists to protect against Bedrock costs, so we
 * must gate before those calls run, even if a later step fails.
 */
export async function checkDailyQuota(
  userId: string
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const table = process.env.AGENT_KEYS_TABLE;
  if (!table) return { allowed: true, used: 0, limit: FREE_TIER_DAILY_LIMIT };

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Expire usage rows after 48h so they don't accumulate indefinitely
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;

  try {
    const result = await getClient().send(
      new UpdateItemCommand({
        TableName: table,
        Key: {
          pk: { S: `USER#${userId}` },
          sk: { S: `USAGE#${today}` },
        },
        UpdateExpression:
          "SET #count = if_not_exists(#count, :zero) + :one, #date = :today, #ttl = :ttl",
        ConditionExpression:
          "attribute_not_exists(#count) OR #count < :limit",
        ExpressionAttributeNames: {
          "#count": "dailyCaptures",
          "#date": "usageDate",
          "#ttl": "expiresAt",
        },
        ExpressionAttributeValues: {
          ":zero": { N: "0" },
          ":one": { N: "1" },
          ":limit": { N: String(FREE_TIER_DAILY_LIMIT) },
          ":today": { S: today },
          ":ttl": { N: String(expiresAt) },
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const used = Number(result.Attributes?.dailyCaptures?.N ?? "1");
    return { allowed: true, used, limit: FREE_TIER_DAILY_LIMIT };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      return {
        allowed: false,
        used: FREE_TIER_DAILY_LIMIT,
        limit: FREE_TIER_DAILY_LIMIT,
      };
    }
    throw err;
  }
}
