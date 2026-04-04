import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { GitHubInstallation } from "./handlers/github-connect";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const agentCore = new BedrockAgentCoreClient({});

interface GitHubEventMessage {
  eventType: string;
  installationId?: number;
  payload: string;
  receivedAt: string;
}

async function getInstallation(
  installationId: string
): Promise<GitHubInstallation | null> {
  // Read at call time so tests can set the env var in beforeEach without
  // the module-level capture racing the Jest mock setup.
  const tableName = process.env.GITHUB_INSTALLATIONS_TABLE!;
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { installationId },
    })
  );
  return (result.Item as GitHubInstallation) ?? null;
}

/**
 * Lightweight pre-filter that rejects events with no meaningful signal
 * before we pay for a DDB lookup + AgentCore invocation.
 *
 * Mirrors the skip logic from the old buildEventContext() helper:
 *  - push: skip tag/branch deletions and empty-commit pushes
 *  - release: skip everything except "published"
 *  - unknown event types: skip
 */
function shouldDispatch(
  eventType: string,
  payload: Record<string, unknown>
): boolean {
  switch (eventType) {
    case "pull_request":
      return true;
    case "push": {
      const ref = payload.ref as string | undefined;
      const commits = (payload.commits as unknown[]) ?? [];
      // Skip tag refs, branch deletions, and empty pushes
      if (!ref?.startsWith("refs/heads/")) return false;
      if (commits.length === 0) return false;
      return true;
    }
    case "release":
      return payload.action === "published";
    default:
      return false;
  }
}

export async function handler(event: SQSEvent): Promise<void> {
  const runtimeArn = process.env.GITHUB_AGENT_RUNTIME_ARN;
  if (!runtimeArn) {
    // Throw so Lambda retries and the batch lands in the DLQ rather than
    // silently acknowledging messages with nowhere to send them.
    throw new Error("[github-agent] GITHUB_AGENT_RUNTIME_ARN is not set — cannot dispatch events");
  }

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

    if (!shouldDispatch(eventType, payload)) {
      console.log("[github-agent] Skipping non-actionable event", {
        eventType,
        action: payload.action,
      });
      continue;
    }

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

    try {
      await agentCore.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn: runtimeArn,
          runtimeSessionId: `github-${installation.userId}-${Date.now()}`,
          runtimeUserId: installation.userId,
          contentType: "application/json",
          payload: Buffer.from(
            JSON.stringify({
              eventType,
              payload,
              userId: installation.userId,
            })
          ),
        })
      );
      console.log("[github-agent] Dispatched to AgentCore Runtime", {
        userId: installation.userId,
        eventType,
      });
    } catch (err) {
      console.error("[github-agent] Failed to invoke AgentCore Runtime", {
        userId: installation.userId,
        eventType,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
