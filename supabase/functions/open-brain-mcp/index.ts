import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Helpers ---

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

// --- Tool definitions ---

const TOOLS = [
  {
    name: "search_thoughts",
    description:
      "Search your brain by meaning. Uses semantic similarity to find relevant thoughts regardless of exact keywords.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you're looking for — natural language" },
        threshold: { type: "number", description: "Similarity threshold 0-1 (lower = broader results)", default: 0.5 },
        limit: { type: "number", description: "Max results to return", default: 10 },
        type: {
          type: "string",
          description: "Filter by type: observation, task, idea, reference, person_note",
        },
        topic: { type: "string", description: "Filter by topic" },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_recent",
    description: "Browse recent thoughts chronologically. Optionally filter by type or topic.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent thoughts", default: 10 },
        type: {
          type: "string",
          description: "Filter by type: observation, task, idea, reference, person_note",
        },
        topic: { type: "string", description: "Filter by topic" },
      },
    },
  },
  {
    name: "stats",
    description: "Get an overview of your brain — total thoughts, breakdown by type, top topics, and people mentioned.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "capture_thought",
    description: "Save a new thought to your brain. Automatically generates embedding and extracts metadata.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The thought to capture" },
      },
      required: ["text"],
    },
  },
  {
    name: "update_thought",
    description: "Update an existing thought by ID. Re-embeds the new text and refreshes metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the thought to update" },
        text: { type: "string", description: "The new text content for the thought" },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "delete_thought",
    description: "Delete a thought by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The UUID of the thought to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "bus_activity",
    description: "Monitor agent bus activity. Shows recent thoughts grouped by agent, activity counts, and timeline.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", description: "Hours to look back (default 24)", default: 24 },
        agent: { type: "string", description: "Filter to a specific agent name" },
        limit: { type: "number", description: "Max recent thoughts to return", default: 20 },
      },
    },
  },
];

// --- Tool handlers ---

async function handleSearchThoughts(args: Record<string, unknown>): Promise<string> {
  const query = args.query as string;
  const threshold = (args.threshold as number) ?? 0.5;
  const limit = (args.limit as number) ?? 10;
  const type = args.type as string | undefined;
  const topic = args.topic as string | undefined;

  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  if (topic) filter.topics = [topic];

  const embedding = await generateEmbedding(query);
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: threshold,
    match_count: limit,
    filter: Object.keys(filter).length > 0 ? filter : {},
  });

  if (error) return `Error: ${error.message}`;
  if (!data?.length) return "No matching thoughts found. Try lowering the threshold.";

  return `Found ${data.length} thought(s):\n\n` +
    data
      .map(
        (t: { content: string; metadata: Record<string, unknown>; similarity: number; created_at: string }) =>
          `[${new Date(t.created_at).toLocaleDateString()}] (${(t.similarity * 100).toFixed(0)}% match)\n${t.content}\nType: ${(t.metadata as Record<string, unknown>)?.type || "unknown"} | Topics: ${((t.metadata as Record<string, unknown>)?.topics as string[])?.join(", ") || "none"}`
      )
      .join("\n\n---\n\n");
}

async function handleBrowseRecent(args: Record<string, unknown>): Promise<string> {
  const limit = (args.limit as number) ?? 10;
  const type = args.type as string | undefined;
  const topic = args.topic as string | undefined;

  let query = supabase
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (type) query = query.eq("metadata->>type", type);
  if (topic) query = query.contains("metadata", { topics: [topic] });

  const { data, error } = await query;

  if (error) return `Error: ${error.message}`;
  if (!data?.length) return "No thoughts found.";

  return `${data.length} recent thought(s):\n\n` +
    data
      .map(
        (t: { content: string; metadata: Record<string, unknown>; created_at: string }) =>
          `[${new Date(t.created_at).toLocaleDateString()}] ${(t.metadata as Record<string, unknown>)?.type || "unknown"}\n${t.content}\nTopics: ${((t.metadata as Record<string, unknown>)?.topics as string[])?.join(", ") || "none"}`
      )
      .join("\n\n---\n\n");
}

async function handleStats(): Promise<string> {
  const { data, error } = await supabase.rpc("stats_summary");

  if (error) return `Error: ${error.message}`;

  const stats = data as {
    total: number;
    earliest: string;
    types: Record<string, number>;
    topics: Record<string, number>;
    people: Record<string, number>;
  };

  const sortDesc = (obj: Record<string, number>) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

  const earliest = stats.earliest
    ? new Date(stats.earliest).toLocaleDateString()
    : "N/A";

  return [
    `Total thoughts: ${stats.total}`,
    `Since: ${earliest}`,
    `\nBy type:\n${sortDesc(stats.types)}`,
    `\nTop topics:\n${sortDesc(stats.topics)}`,
    Object.keys(stats.people).length ? `\nPeople mentioned:\n${sortDesc(stats.people)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleUpdateThought(args: Record<string, unknown>): Promise<string> {
  const id = args.id as string;
  const text = args.text as string;

  const [embedding, metadata] = await Promise.all([generateEmbedding(text), extractMetadata(text)]);

  const { error } = await supabase
    .from("thoughts")
    .update({ content: text, embedding, metadata })
    .eq("id", id);

  if (error) return `Error updating: ${error.message}`;

  const meta = metadata as Record<string, unknown>;
  let confirmation = `Updated as ${meta.type}`;
  if (Array.isArray(meta.topics) && meta.topics.length > 0)
    confirmation += ` — ${meta.topics.join(", ")}`;

  return confirmation;
}

async function handleDeleteThought(args: Record<string, unknown>): Promise<string> {
  const id = args.id as string;

  const { error } = await supabase.from("thoughts").delete().eq("id", id);

  if (error) return `Error deleting: ${error.message}`;

  return `Deleted thought ${id}`;
}

async function handleCaptureThought(args: Record<string, unknown>, agentName: string): Promise<string> {
  const text = args.text as string;

  const [embedding, metadata] = await Promise.all([generateEmbedding(text), extractMetadata(text)]);
  (metadata as Record<string, unknown>).agent_id = agentName;

  const { error } = await supabase.from("thoughts").insert({
    content: text,
    embedding,
    metadata,
  });

  if (error) return `Error saving: ${error.message}`;

  const meta = metadata as Record<string, unknown>;
  let confirmation = `Captured as ${meta.type} (agent: ${agentName})`;
  if (Array.isArray(meta.topics) && meta.topics.length > 0)
    confirmation += ` — ${meta.topics.join(", ")}`;
  if (Array.isArray(meta.people) && meta.people.length > 0)
    confirmation += `\nPeople: ${meta.people.join(", ")}`;
  if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
    confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

  return confirmation;
}

async function handleBusActivity(args: Record<string, unknown>): Promise<string> {
  const hours = (args.hours as number) ?? 24;
  const agent = args.agent as string | undefined;
  const limit = (args.limit as number) ?? 20;

  const { data, error } = await supabase.rpc("bus_activity", {
    hours_back: hours,
    agent_filter: agent || null,
    result_limit: limit,
  });

  if (error) return `Error: ${error.message}`;

  const activity = data as {
    summary: { total_thoughts: number; active_agents: number; hours: number };
    by_agent: { agent: string; thought_count: number; last_active: string }[];
    recent: { content: string; agent: string; type: string; topics: string[]; created_at: string }[];
  };

  const lines: string[] = [];
  lines.push(`Bus activity (last ${activity.summary.hours}h): ${activity.summary.total_thoughts} thoughts, ${activity.summary.active_agents} active agents`);

  if (activity.by_agent.length > 0) {
    lines.push("\nBy agent:");
    for (const a of activity.by_agent) {
      lines.push(`  ${a.agent || "unknown"}: ${a.thought_count} thoughts (last: ${new Date(a.last_active).toLocaleString()})`);
    }
  }

  if (activity.recent.length > 0) {
    lines.push("\nRecent:");
    for (const t of activity.recent) {
      lines.push(`  [${new Date(t.created_at).toLocaleString()}] ${t.agent || "unknown"} (${t.type}): ${t.content.slice(0, 100)}${t.content.length > 100 ? "..." : ""}`);
    }
  }

  return lines.join("\n");
}

// --- Auth ---

async function authenticate(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-brain-key");
  if (!key) return null;

  const { data, error } = await supabase
    .from("agent_keys")
    .select("agent_name")
    .eq("api_key", key)
    .single();

  if (error || !data) return null;
  return data.agent_name;
}

// --- JSON-RPC helpers ---

function jsonrpc(id: string | number | null, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function jsonrpcError(id: string | number | null, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

// --- MCP protocol handler ---

Deno.serve(async (req) => {
  // CORS for browser-based clients
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-brain-key",
      },
    });
  }

  // Health check
  if (req.method === "GET") {
    return Response.json({ status: "ok", name: "open-brain-mcp" });
  }

  if (req.method !== "POST") {
    return jsonrpcError(null, -32600, "Method not allowed", 405);
  }

  const agentName = await authenticate(req);
  if (!agentName) {
    return jsonrpcError(null, -32600, "Unauthorized", 401);
  }

  const body = await req.json();
  const { method, id, params } = body;

  // MCP: initialize
  if (method === "initialize") {
    return jsonrpc(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "open-brain", version: "1.0.0" },
    });
  }

  // MCP: initialized notification
  if (method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  // MCP: list tools
  if (method === "tools/list") {
    return jsonrpc(id, { tools: TOOLS });
  }

  // MCP: call tool
  if (method === "tools/call") {
    const toolName = params?.name as string;
    const args = (params?.arguments ?? {}) as Record<string, unknown>;

    let resultText: string;
    try {
      switch (toolName) {
        case "search_thoughts":
          resultText = await handleSearchThoughts(args);
          break;
        case "browse_recent":
          resultText = await handleBrowseRecent(args);
          break;
        case "stats":
          resultText = await handleStats();
          break;
        case "capture_thought":
          resultText = await handleCaptureThought(args, agentName);
          break;
        case "update_thought":
          resultText = await handleUpdateThought(args);
          break;
        case "delete_thought":
          resultText = await handleDeleteThought(args);
          break;
        case "bus_activity":
          resultText = await handleBusActivity(args);
          break;
        default:
          return jsonrpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
    } catch (e) {
      resultText = `Error: ${(e as Error).message}`;
    }

    return jsonrpc(id, { content: [{ type: "text", text: resultText }] });
  }

  // MCP: ping
  if (method === "ping") {
    return jsonrpc(id, {});
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`);
});
