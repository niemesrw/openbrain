import { randomInt } from "crypto";
import {
  DynamoDBClient,
  PutItemCommand,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import type { TelegramLinkArgs, TelegramLinkResult, UserContext } from "../types";

const dynamo = new DynamoDBClient({});

const TOKEN_TTL_SECONDS = 10 * 60; // 10 minutes
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
const MAX_RETRIES = 5;

function generateCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  }
  return code;
}

export async function handleTelegramLink(
  _args: TelegramLinkArgs,
  user: UserContext
): Promise<TelegramLinkResult> {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateCode();
    try {
      await dynamo.send(
        new PutItemCommand({
          TableName: process.env.TELEGRAM_TOKENS_TABLE!,
          Item: {
            token: { S: code },
            userId: { S: user.userId },
            displayName: { S: user.displayName || "Anonymous" },
            expiresAt: { N: String(expiresAt) },
          },
          // Prevent overwriting an existing (unexpired) token
          ConditionExpression: "attribute_not_exists(#t)",
          ExpressionAttributeNames: { "#t": "token" },
        })
      );
      return { code, expiresAt: expiresAt * 1000 };
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException && attempt < MAX_RETRIES - 1) {
        continue; // collision — retry with a new code
      }
      throw e;
    }
  }

  throw new Error("Failed to generate a unique link code after multiple attempts");
}
