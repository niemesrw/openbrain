/**
 * AgentCore Memory service — session layer on top of S3 Vectors brain storage.
 *
 * Provides STM (short-term memory) for within-session conversation context and
 * LTM (long-term memory) for cross-session preference/knowledge retrieval.
 * S3 Vectors remains the primary brain storage; this is a complementary layer.
 */

import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
  RetrieveMemoryRecordsCommand,
  Role,
} from "@aws-sdk/client-bedrock-agentcore";

let _client: BedrockAgentCoreClient | undefined;
function getClient(): BedrockAgentCoreClient {
  if (!_client) _client = new BedrockAgentCoreClient({});
  return _client;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SessionEvent {
  eventId?: string;
  eventTimestamp?: number;
  turns: ConversationTurn[];
}

/**
 * Save conversation turns to short-term memory for a session.
 *
 * @param memoryId  - The AgentCore Memory resource ID (from AGENTCORE_MEMORY_ID)
 * @param actorId   - Identifies the actor (e.g. "user-abc")
 * @param sessionId - Groups events within a session (e.g. "github-pr-owner-repo-42")
 * @param turns     - The conversation turns to persist
 */
export async function saveSessionEvent(
  memoryId: string,
  actorId: string,
  sessionId: string,
  turns: ConversationTurn[]
): Promise<void> {
  if (!memoryId || turns.length === 0) return;

  await getClient().send(
    new CreateEventCommand({
      memoryId,
      actorId,
      sessionId,
      payload: turns.map((t) => ({
        conversational: {
          content: { text: t.content },
          role: t.role === "user" ? Role.USER : Role.ASSISTANT,
        },
      })),
      eventTimestamp: new Date(),
    })
  );
}

/**
 * Load recent conversation events from short-term memory for a session.
 *
 * @param memoryId  - The AgentCore Memory resource ID
 * @param actorId   - The actor identifier
 * @param sessionId - The session identifier
 * @param maxEvents - Maximum number of events to return (default 20)
 * @returns         - Array of session events (oldest first)
 */
export async function loadSessionHistory(
  memoryId: string,
  actorId: string,
  sessionId: string,
  maxEvents = 20
): Promise<SessionEvent[]> {
  if (!memoryId) return [];

  try {
    const response = await getClient().send(
      new ListEventsCommand({
        memoryId,
        actorId,
        sessionId,
        maxResults: maxEvents,
        includePayloads: true,
      })
    );

    const events = response.events ?? [];
    return events.map((ev) => {
      const turns: ConversationTurn[] = [];
      for (const item of ev.payload ?? []) {
        if (item.conversational) {
          const role = item.conversational.role;
          // Only include user/assistant turns; skip TOOL, OTHER, and unknown roles
          if (role !== Role.USER && role !== Role.ASSISTANT) continue;
          const mappedRole = role === Role.USER ? "user" : "assistant";
          const text = item.conversational.content?.text ?? "";
          turns.push({ role: mappedRole, content: text });
        }
      }
      return {
        eventId: ev.eventId,
        eventTimestamp: ev.eventTimestamp
          ? new Date(ev.eventTimestamp).getTime()
          : undefined,
        turns,
      };
    });
  } catch (err) {
    console.warn(
      "[agentcore-memory] loadSessionHistory failed — continuing without session history",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

/**
 * Format session history as a human-readable string for injecting into prompts.
 * Truncates from the oldest turns to stay within the character budget, keeping
 * the most recent context which is most relevant to the current invocation.
 *
 * @param history  - Session events from loadSessionHistory
 * @param maxChars - Maximum characters in the output (default 4000 ≈ ~1k tokens)
 * @returns        - Formatted string, or empty string if no history
 */
export function formatSessionHistory(
  history: SessionEvent[],
  maxChars = 4000
): string {
  const turns = history.flatMap((ev) => ev.turns);
  if (turns.length === 0) return "";

  const lines = turns.map(
    (t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`
  );

  // Work backwards from the most recent turn, accumulating lines until budget
  const kept: string[] = [];
  let budget = maxChars;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + (kept.length > 0 ? 1 : 0); // +1 for \n
    if (cost > budget) break;
    kept.push(lines[i]);
    budget -= cost;
  }

  return kept.reverse().join("\n");
}

/**
 * Retrieve relevant long-term memory records via semantic search.
 *
 * @param memoryId    - The AgentCore Memory resource ID
 * @param namespace   - Namespace prefix for scoping records (e.g. "/users/user-abc/")
 * @param searchQuery - Natural language query describing what to retrieve
 * @param topK        - Maximum number of records to return (default 5)
 * @returns           - Formatted string of LTM records, or empty string if none
 */
export async function retrieveLongTermMemory(
  memoryId: string,
  namespace: string,
  searchQuery: string,
  topK = 5
): Promise<string> {
  if (!memoryId) return "";

  try {
    const response = await getClient().send(
      new RetrieveMemoryRecordsCommand({
        memoryId,
        namespace,
        searchCriteria: {
          searchQuery,
          topK,
        },
      })
    );

    const records = response.memoryRecordSummaries ?? [];
    if (records.length === 0) return "";

    return records
      .map((r) => (r.content && "text" in r.content ? r.content.text : ""))
      .filter(Boolean)
      .join("\n---\n");
  } catch (err) {
    console.warn(
      "[agentcore-memory] retrieveLongTermMemory failed — continuing without LTM",
      err instanceof Error ? err.message : String(err)
    );
    return "";
  }
}

/**
 * Extract the final assistant text from a multi-step generateText result.
 * Falls back to collecting text across all steps when the top-level text is empty.
 *
 * @param result - The return value from `generateText` (ai SDK)
 * @returns      - The assistant's final response text, or empty string
 */
export function extractAssistantText(result: {
  text?: string;
  steps?: Array<{ text?: string }>;
}): string {
  if (result.text) return result.text;
  return (result.steps ?? [])
    .map((s) => s.text ?? "")
    .filter(Boolean)
    .join("\n");
}
