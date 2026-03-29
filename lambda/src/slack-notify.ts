/**
 * Slack Notify Worker
 *
 * SQS-triggered Lambda. Receives thought payloads from the openbrain-slack-notify
 * queue (enqueued by capture-thought when a channel: topic is detected) and posts
 * a DM (or shared channel message) to the user's connected Slack workspace.
 */
import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const SLACK_INSTALLATIONS_TABLE = process.env.SLACK_INSTALLATIONS_TABLE!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface SlackNotifyMessage {
  userId: string;
  thoughtId: string;
  text: string;
  topics: string[];
}

interface SlackInstallationRecord {
  teamId: string;
  userId: string;
  slackUserId: string;
  accessToken: string;
  slackChannelId?: string;
}

async function getInstallation(userId: string): Promise<SlackInstallationRecord | null> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: SLACK_INSTALLATIONS_TABLE,
      IndexName: "user-id-index",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": userId },
      Limit: 1,
    })
  );
  if (!result.Items || result.Items.length === 0) return null;
  return result.Items[0] as SlackInstallationRecord;
}

async function openDmChannel(token: string, slackUserId: string): Promise<string> {
  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ users: slackUserId }),
  });
  if (!res.ok) throw new Error(`conversations.open HTTP error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string; channel?: { id: string } };
  if (!data.ok) throw new Error(`conversations.open error: ${data.error ?? "unknown"}`);
  const channelId = data.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel ID");
  return channelId;
}

async function postMessage(token: string, channel: string, text: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text }),
  });
  if (!res.ok) throw new Error(`chat.postMessage HTTP error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`chat.postMessage error: ${data.error ?? "unknown"}`);
}

function formatNotification(text: string, topics: string[]): string {
  const truncated = text.length > 200 ? `${text.slice(0, 200)}\u2026` : text;
  const topicList = topics.map(t => `\`${t}\``).join(" ");
  return `\uD83E\uDDE0 *New brain activity*\n> ${truncated}\nTopics: ${topicList}`;
}

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    let message: SlackNotifyMessage;
    try {
      message = JSON.parse(record.body) as SlackNotifyMessage;
    } catch {
      console.error("[slack-notify] Failed to parse SQS record", record.messageId);
      continue;
    }

    const { userId, thoughtId, text, topics } = message;
    console.log("[slack-notify] Processing notification", { userId, thoughtId });

    let installation: SlackInstallationRecord | null;
    try {
      installation = await getInstallation(userId);
    } catch (err) {
      console.error("[slack-notify] DynamoDB lookup failed", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!installation) {
      console.log("[slack-notify] No Slack installation for user — skipping", { userId });
      continue;
    }

    const { accessToken, slackUserId, slackChannelId } = installation;
    const isSharedChannel = topics.includes("channel:shared");

    try {
      // Use configured shared channel for channel:shared topics; otherwise DM the user
      const targetChannel =
        isSharedChannel && slackChannelId
          ? slackChannelId
          : await openDmChannel(accessToken, slackUserId);

      await postMessage(accessToken, targetChannel, formatNotification(text, topics));
      console.log("[slack-notify] Notification sent", { userId, thoughtId, targetChannel });
    } catch (err) {
      console.error("[slack-notify] Failed to send Slack message", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
