import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { handleCaptureThought } from "./handlers/capture-thought";
import { getInstallationToken } from "./services/github-app";
import { buildEventContext } from "./services/github-context";
import type { GitHubInstallation } from "./handlers/github-connect";

const GITHUB_INSTALLATIONS_TABLE = process.env.GITHUB_INSTALLATIONS_TABLE!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface GitHubEventMessage {
  eventType: string;
  installationId?: number;
  payload: string;
  receivedAt: string;
}

async function getInstallation(
  installationId: string
): Promise<GitHubInstallation | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: GITHUB_INSTALLATIONS_TABLE,
      Key: { installationId },
    })
  );
  return (result.Item as GitHubInstallation) ?? null;
}

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    let message: GitHubEventMessage;
    try {
      message = JSON.parse(record.body) as GitHubEventMessage;
    } catch {
      console.error("[github-agent] Failed to parse SQS record", record.messageId);
      continue;
    }

    const { eventType, installationId, payload: rawPayload, receivedAt } = message;

    console.log("[github-agent] Processing event", {
      eventType,
      installationId,
      receivedAt,
    });

    if (!installationId) {
      console.warn("[github-agent] No installationId — skipping");
      continue;
    }

    const installationIdStr = String(installationId);

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawPayload) as Record<string, unknown>;
    } catch {
      console.error("[github-agent] Failed to parse payload", record.messageId);
      continue;
    }

    // Build structured context from the webhook payload
    const context = buildEventContext(eventType, payload);
    if (!context) {
      console.log("[github-agent] Skipping non-actionable event", {
        eventType,
        action: (payload as Record<string, string>).action,
      });
      continue;
    }

    // Look up which user owns this installation
    let installation: GitHubInstallation | null;
    try {
      installation = await getInstallation(installationIdStr);
    } catch (err) {
      console.error("[github-agent] DynamoDB lookup failed", {
        installationId: installationIdStr,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!installation) {
      console.warn("[github-agent] No user registered for installation", {
        installationId: installationIdStr,
      });
      continue;
    }

    // Fetch installation token (validates the App credential; enables future enrichment)
    try {
      await getInstallationToken(installationIdStr);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Rethrow transient errors so SQS retries the message
      if (msg.includes("429") || msg.includes("503")) throw err;
      console.error("[github-agent] Failed to get installation token — continuing without it", { err: msg });
    }

    // Capture to the user's brain
    try {
      const result = await handleCaptureThought(
        { text: context.summary, scope: "private" },
        { userId: installation.userId, agentName: "github-agent" }
      );
      console.log("[github-agent] Captured thought", {
        userId: installation.userId,
        eventType,
        repo: context.repoFullName,
        result,
      });
    } catch (err) {
      console.error("[github-agent] Failed to capture thought", {
        userId: installation.userId,
        eventType,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
