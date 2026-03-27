import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handleCaptureThought } from "./capture-thought";
import { handleSearchThoughts } from "./search-thoughts";
import { handleBrowseRecent } from "./browse-recent";
import { handleInsight } from "./insight";
import type { UserContext } from "../types";

const dynamo = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});

// Cache bot token across warm invocations
let cachedBotToken: string | null = null;

async function getBotToken(): Promise<string> {
  if (cachedBotToken) return cachedBotToken;
  const secretArn = process.env.TELEGRAM_BOT_TOKEN_SECRET_ARN!;
  const res = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  cachedBotToken = res.SecretString!.trim();
  return cachedBotToken;
}

async function sendMessage(
  chatId: number,
  text: string,
  botToken: string
): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      let errorBody: string | undefined;
      try { errorBody = await res.text(); } catch { /* ignore */ }
      console.error("sendMessage non-2xx from Telegram", {
        chatId,
        status: res.status,
        body: errorBody,
      });
    }
  } catch (e) {
    console.error("sendMessage failed:", e instanceof Error ? e.message : String(e));
  }
}

async function lookupUser(telegramUserId: string): Promise<UserContext | null> {
  const res = await dynamo.send(
    new GetItemCommand({
      TableName: process.env.TELEGRAM_USERS_TABLE!,
      Key: { telegramUserId: { S: telegramUserId } },
    })
  );
  if (!res.Item) return null;
  return {
    userId: res.Item.userId.S!,
    displayName: res.Item.displayName?.S,
  };
}

async function linkAccount(
  telegramUserId: string,
  code: string,
  firstName?: string
): Promise<UserContext | null> {
  const res = await dynamo.send(
    new GetItemCommand({
      TableName: process.env.TELEGRAM_TOKENS_TABLE!,
      Key: { token: { S: code.toUpperCase() } },
    })
  );

  if (!res.Item) return null;

  const expiresAt = Number(res.Item.expiresAt?.N ?? 0);
  if (Math.floor(Date.now() / 1000) > expiresAt) return null;

  const userId = res.Item.userId.S!;
  const displayName = res.Item.displayName?.S || firstName || "Anonymous";

  // Atomically consume the token (one-time use) and write the user mapping
  await dynamo.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Delete: {
            TableName: process.env.TELEGRAM_TOKENS_TABLE!,
            Key: { token: { S: code.toUpperCase() } },
            ConditionExpression: "attribute_exists(#t)",
            ExpressionAttributeNames: { "#t": "token" },
          },
        },
        {
          Put: {
            TableName: process.env.TELEGRAM_USERS_TABLE!,
            Item: {
              telegramUserId: { S: telegramUserId },
              userId: { S: userId },
              displayName: { S: displayName },
              linkedAt: { N: String(Math.floor(Date.now() / 1000)) },
            },
          },
        },
      ],
    })
  );

  return { userId, displayName };
}

interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name?: string; username?: string };
  chat: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export async function handleTelegramWebhook(
  event: APIGatewayProxyEventV2
): Promise<{ statusCode: number }> {
  let update: TelegramUpdate;
  try {
    update = JSON.parse(event.body || "{}") as TelegramUpdate;
  } catch {
    return { statusCode: 400 };
  }

  const message = update.message ?? update.edited_message;
  if (!message?.text) return { statusCode: 200 };

  const chatId = message.chat.id;
  const telegramUserId = String(message.from.id);
  const text = message.text.trim();
  const firstName = message.from.first_name || "there";

  const botToken = await getBotToken();

  // Parse command (e.g. "/search query" or plain text)
  const commandMatch = text.match(/^(\/\w+)(?:\s+(.*))?$/s);
  const command = commandMatch ? commandMatch[1].toLowerCase() : null;
  const argText = commandMatch ? (commandMatch[2] ?? "").trim() : text;

  try {
    if (command === "/start") {
      const user = await lookupUser(telegramUserId);
      if (user) {
        await sendMessage(
          chatId,
          `Welcome back, ${user.displayName}! Your brain is ready 🧠\n\n*Commands:*\n/capture \\<text\\> — save a thought\n/search \\<query\\> — search your brain\n/browse — recent thoughts\n/insight — surface a pattern\n\nOr just send me any message to capture it.`,
          botToken
        );
      } else {
        await sendMessage(
          chatId,
          `Hello ${firstName}\\! I'm your Open Brain assistant 🧠\n\nTo get started:\n1\\. Open the *Open Brain web app*\n2\\. Click *Connect Telegram*\n3\\. Send me */link <code>*`,
          botToken
        );
      }
      return { statusCode: 200 };
    }

    if (command === "/link") {
      if (!argText) {
        await sendMessage(
          chatId,
          "Usage: /link <code>\n\nGet your code from the Open Brain web app → Connect Telegram.",
          botToken
        );
        return { statusCode: 200 };
      }

      const user = await linkAccount(telegramUserId, argText, firstName);
      if (!user) {
        await sendMessage(
          chatId,
          "❌ Invalid or expired code. Codes expire after 10 minutes.\n\nGenerate a new one in the web app.",
          botToken
        );
      } else {
        await sendMessage(
          chatId,
          `✅ Account linked! Welcome, ${user.displayName} 🎉\n\nYour brain is ready. Just send me a message to capture a thought, or use:\n/search <query>\n/browse\n/insight`,
          botToken
        );
      }
      return { statusCode: 200 };
    }

    // All other commands require a linked account
    const user = await lookupUser(telegramUserId);
    if (!user) {
      await sendMessage(
        chatId,
        "👋 Please link your account first. Send /start for instructions.",
        botToken
      );
      return { statusCode: 200 };
    }

    if (command === "/capture") {
      if (!argText) {
        await sendMessage(
          chatId,
          "Usage: /capture <text>\n\nOr just send me any message to capture it.",
          botToken
        );
        return { statusCode: 200 };
      }
      const result = await handleCaptureThought({ text: argText }, user);
      await sendMessage(chatId, `✅ ${result}`, botToken);
      return { statusCode: 200 };
    }

    if (command === "/search") {
      if (!argText) {
        await sendMessage(chatId, "Usage: /search <query>", botToken);
        return { statusCode: 200 };
      }
      const result = await handleSearchThoughts(
        { query: argText, scope: "all", limit: 5 },
        user
      );
      await sendMessage(chatId, result, botToken);
      return { statusCode: 200 };
    }

    if (command === "/browse") {
      const result = await handleBrowseRecent({ scope: "all", limit: 5 }, user);
      await sendMessage(chatId, result, botToken);
      return { statusCode: 200 };
    }

    if (command === "/insight") {
      const result = await handleInsight(user);
      if (!result) {
        await sendMessage(
          chatId,
          "No insight available yet — capture more thoughts first!",
          botToken
        );
      } else {
        await sendMessage(
          chatId,
          `💡 *${result.headline}*\n\n${result.body}`,
          botToken
        );
      }
      return { statusCode: 200 };
    }

    // Unknown slash command
    if (command) {
      await sendMessage(
        chatId,
        "Unknown command. Available: /capture, /search, /browse, /insight",
        botToken
      );
      return { statusCode: 200 };
    }

    // Plain text (non-command) → capture as private thought
    const result = await handleCaptureThought({ text }, user);
    await sendMessage(chatId, `✅ Captured! ${result}`, botToken);
  } catch (e) {
    console.error("Telegram bot error:", e);
    await sendMessage(
      chatId,
      "⚠️ Something went wrong. Please try again.",
      botToken
    ).catch(() => {});
  }

  return { statusCode: 200 };
}
