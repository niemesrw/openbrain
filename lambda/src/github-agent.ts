import type { SQSEvent } from "aws-lambda";

interface GitHubEventMessage {
  eventType: string;
  installationId?: number;
  payload: string;
  receivedAt: string;
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

    console.log("[github-agent] Processing event", {
      eventType: message.eventType,
      installationId: message.installationId,
      receivedAt: message.receivedAt,
    });

    // Phase 2: fetch full GitHub context via installation token,
    // run LLM extraction pass, capture structured thought to user's brain.
  }
}
