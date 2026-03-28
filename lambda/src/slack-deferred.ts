/**
 * Slack Deferred Worker
 *
 * Invoked asynchronously (InvocationType: 'Event') by the Slack webhook Lambda
 * after it has already returned the 200 ack to Slack. Performs the actual brain
 * search/capture and posts the result to Slack's response_url or chat.postMessage.
 */
import { handleSearchThoughts } from "./handlers/search-thoughts";
import { handleCaptureThought } from "./handlers/capture-thought";

async function postToResponseUrl(url: string, text: string): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text }),
    });
    if (!res.ok) {
      console.error("[slack-deferred] Failed to post to response_url:", res.status, res.statusText);
    }
  } catch (err) {
    console.error("[slack-deferred] Network error posting to response_url:", err instanceof Error ? err.message : String(err));
  }
}

async function postMessage(token: string, channel: string, text: string): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text }),
  });
  if (!res.ok) {
    console.error("[slack-deferred] Slack chat.postMessage HTTP error:", res.status, res.statusText);
    throw new Error(`Slack chat.postMessage HTTP error: ${res.status}`);
  }
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) {
    console.error("[slack-deferred] Slack chat.postMessage error:", data.error ?? "unknown");
    throw new Error(`Slack chat.postMessage error: ${data.error ?? "unknown"}`);
  }
}

export interface SlashSearchPayload {
  type: "slash_search";
  query: string;
  userId: string;
  responseUrl: string;
}

export interface SlashCapturePayload {
  type: "slash_capture";
  text: string;
  userId: string;
  responseUrl: string;
}

export interface DmMessagePayload {
  type: "dm_message";
  text: string;
  userId: string;
  accessToken: string;
  channel: string;
}

export type DeferredPayload = SlashSearchPayload | SlashCapturePayload | DmMessagePayload;

export async function handler(event: DeferredPayload): Promise<void> {
  const user = { userId: event.userId };

  if (event.type === "slash_search") {
    try {
      const result = await handleSearchThoughts(
        { query: event.query, limit: 5, threshold: 0.5, scope: "private" },
        user
      );
      await postToResponseUrl(event.responseUrl, result);
    } catch (err) {
      console.error("[slack-deferred] Search error:", err instanceof Error ? err.message : String(err));
      await postToResponseUrl(event.responseUrl, "Sorry, something went wrong while searching your brain.");
    }
    return;
  }

  if (event.type === "slash_capture") {
    try {
      const result = await handleCaptureThought(
        { text: event.text, scope: "private" },
        user
      );
      await postToResponseUrl(event.responseUrl, result);
    } catch (err) {
      console.error("[slack-deferred] Capture error:", err instanceof Error ? err.message : String(err));
      await postToResponseUrl(event.responseUrl, "Sorry, something went wrong while capturing your thought.");
    }
    return;
  }

  if (event.type === "dm_message") {
    const captureMatch = event.text.match(/^(?:capture|save)[:\s]\s*(.+)/is);
    try {
      let responseText: string;
      if (captureMatch) {
        responseText = await handleCaptureThought(
          { text: captureMatch[1].trim(), scope: "private" },
          user
        );
      } else {
        responseText = await handleSearchThoughts(
          { query: event.text, limit: 5, threshold: 0.5, scope: "private" },
          user
        );
      }
      await postMessage(event.accessToken, event.channel, responseText);
    } catch (err) {
      console.error("[slack-deferred] DM error:", err instanceof Error ? err.message : String(err));
      await postMessage(event.accessToken, event.channel, "Sorry, I encountered an error. Try again or use `/brain` commands.");
    }
    return;
  }
}
