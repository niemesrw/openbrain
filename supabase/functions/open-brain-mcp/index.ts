import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

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

async function handleCaptureThought(args: Record<string, unknown>): Promise<string> {
  const text = args.text as string;

  const [embedding, metadata] = await Promise.all([generateEmbedding(text), extractMetadata(text)]);

  const { error } = await supabase.from("thoughts").insert({
    content: text,
    embedding,
    metadata,
  });

  if (error) return `Error saving: ${error.message}`;

  const meta = metadata as Record<string, unknown>;
  let confirmation = `Captured as ${meta.type}`;
  if (Array.isArray(meta.topics) && meta.topics.length > 0)
    confirmation += ` — ${meta.topics.join(", ")}`;
  if (Array.isArray(meta.people) && meta.people.length > 0)
    confirmation += `\nPeople: ${meta.people.join(", ")}`;
  if (Array.isArray(meta.action_items) && meta.action_items.length > 0)
    confirmation += `\nAction items: ${meta.action_items.join("; ")}`;

  return confirmation;
}

// --- Auth ---

function authenticate(req: Request): boolean {
  const url = new URL(req.url);
  const keyFromQuery = url.searchParams.get("key");
  const keyFromHeader = req.headers.get("x-brain-key");
  return (keyFromQuery || keyFromHeader) === MCP_ACCESS_KEY;
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

  if (!authenticate(req)) {
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
          resultText = await handleCaptureThought(args);
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
