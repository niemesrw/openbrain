# Agent Bus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-agent API keys, auto-tagged identity on captures, a `bus_activity` monitoring tool, and a web dashboard to Open Brain.

**Architecture:** New `agent_keys` table for auth lookup. Edge Function authenticates by querying the table instead of env var. Captured thoughts get `agent_id` injected server-side. New `bus_activity` SQL function powers both an MCP tool and an HTML dashboard served from a separate Edge Function.

**Tech Stack:** Supabase (Postgres, Edge Functions/Deno), SQL, TypeScript, HTML/CSS/JS

---

### Task 1: Migration — `agent_keys` table and `bus_activity()` function

**Files:**
- Create: `supabase/migrations/20260311000000_agent_bus.sql`

**Step 1: Write the migration file**

```sql
-- Agent keys table for per-agent authentication
create table agent_keys (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null unique,
  api_key text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz default now()
);

-- Index for fast key lookups
create index on agent_keys (api_key);

-- RLS: service role only
alter table agent_keys enable row level security;

create policy "Service role full access"
  on agent_keys
  for all
  using (auth.role() = 'service_role');

-- Seed the existing personal key (must match .setup-state and client configs)
insert into agent_keys (agent_name, api_key)
values ('personal', 'a74ab05daf2ec7ad928ddfe7142c069eed5d9b9f3eaba13904f25c163d993003');

-- Bus activity: recent thoughts grouped by agent for monitoring
create or replace function bus_activity(
  hours_back int default 24,
  agent_filter text default null,
  result_limit int default 20
)
returns json
language plpgsql
as $$
declare
  result json;
  cutoff timestamptz := now() - (hours_back || ' hours')::interval;
begin
  select json_build_object(
    'summary', (
      select json_build_object(
        'total_thoughts', count(*),
        'active_agents', count(distinct metadata->>'agent_id'),
        'hours', hours_back
      )
      from thoughts
      where created_at >= cutoff
        and (agent_filter is null or metadata->>'agent_id' = agent_filter)
    ),
    'by_agent', (
      select coalesce(json_agg(agent_row), '[]')
      from (
        select
          coalesce(metadata->>'agent_id', 'unknown') as agent,
          count(*) as thought_count,
          max(created_at) as last_active
        from thoughts
        where created_at >= cutoff
          and (agent_filter is null or metadata->>'agent_id' = agent_filter)
        group by metadata->>'agent_id'
        order by count(*) desc
      ) agent_row
    ),
    'recent', (
      select coalesce(json_agg(thought_row), '[]')
      from (
        select
          content,
          metadata->>'agent_id' as agent,
          metadata->>'type' as type,
          metadata->'topics' as topics,
          created_at
        from thoughts
        where created_at >= cutoff
          and (agent_filter is null or metadata->>'agent_id' = agent_filter)
        order by created_at desc
        limit result_limit
      ) thought_row
    )
  ) into result;

  return result;
end;
$$;
```

**Step 2: Push the migration**

Run: `supabase db push`
Expected: `Applying migration 20260311000000_agent_bus.sql... Finished supabase db push.`

**Step 3: Verify the personal key was seeded**

Run: `supabase db execute --sql "select agent_name, left(api_key, 8) as key_prefix from agent_keys"`
Expected: One row: `personal | a74ab05d`

**Step 4: Commit**

```bash
git add supabase/migrations/20260311000000_agent_bus.sql
git commit -m "feat: add agent_keys table, seed personal key, add bus_activity() function"
```

---

### Task 2: Update Edge Function — table-based auth + auto-tagging + bus_activity tool

**Files:**
- Modify: `supabase/functions/open-brain-mcp/index.ts`

**Step 1: Remove `MCP_ACCESS_KEY` constant**

Delete line 6: `const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;`

**Step 2: Rewrite `authenticate()` to return agent name from table**

Replace the existing `authenticate` function with:

```typescript
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
```

**Step 3: Update main handler auth check**

Change:
```typescript
  if (!authenticate(req)) {
    return jsonrpcError(null, -32600, "Unauthorized", 401);
  }
```
to:
```typescript
  const agentName = await authenticate(req);
  if (!agentName) {
    return jsonrpcError(null, -32600, "Unauthorized", 401);
  }
```

**Step 4: Update `handleCaptureThought` to accept and inject agent name**

Change function signature and inject `agent_id`:

```typescript
async function handleCaptureThought(args: Record<string, unknown>, agentName: string): Promise<string> {
  const text = args.text as string;

  const [embedding, metadata] = await Promise.all([generateEmbedding(text), extractMetadata(text)]);

  // Inject agent identity into metadata
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
```

Update the switch case to pass `agentName`:
```typescript
        case "capture_thought":
          resultText = await handleCaptureThought(args, agentName);
          break;
```

**Step 5: Add `bus_activity` tool definition to TOOLS array**

After the `capture_thought` entry:

```typescript
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
```

**Step 6: Add `handleBusActivity` function**

After `handleCaptureThought`:

```typescript
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
```

Add to the switch:
```typescript
        case "bus_activity":
          resultText = await handleBusActivity(args);
          break;
```

**Step 7: Commit**

```bash
git add supabase/functions/open-brain-mcp/index.ts
git commit -m "feat: table-based auth, auto-tag agent_id, add bus_activity tool"
```

---

### Task 3: Deploy and smoke test MCP function

**Step 1: Deploy**

Run: `supabase functions deploy open-brain-mcp --no-verify-jwt`

**Step 2: Smoke test — stats still works**

Call `stats` via MCP to verify existing auth works with table-based lookup.

**Step 3: Smoke test — capture and verify agent_id**

Capture a test thought, then browse recent to confirm `agent_id: "personal"` in metadata.

**Step 4: Smoke test — bus_activity**

Call `bus_activity` via MCP to see agent activity.

---

### Task 4: Create dashboard Edge Function

**Files:**
- Create: `supabase/functions/open-brain-dashboard/deno.json`
- Create: `supabase/functions/open-brain-dashboard/index.ts`

**Step 1: Create `deno.json`**

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.47.10"
  }
}
```

**Step 2: Create the dashboard function**

Create `supabase/functions/open-brain-dashboard/index.ts`. This function serves an HTML dashboard page and a `/api` JSON endpoint. The HTML uses `textContent` and `escapeHtml()` for all user-provided content to prevent XSS. The `/api` endpoint authenticates via `x-brain-key` query param and calls `bus_activity()` RPC.

Key security notes:
- All dynamic content rendered via `escapeHtml()` which uses `document.createElement("div").textContent = s`
- No raw `innerHTML` with user content — agent names, types, and thought content are all escaped
- API endpoint validates key against `agent_keys` table before returning data

**Step 3: Deploy**

Run: `supabase functions deploy open-brain-dashboard --no-verify-jwt`

**Step 4: Verify**

Open the dashboard URL in browser with `?key=<personal-key>` and confirm it loads with activity data.

**Step 5: Commit**

```bash
git add supabase/functions/open-brain-dashboard/
git commit -m "feat: add bus monitoring web dashboard"
```

---

### Task 5: Update deploy workflow and CLAUDE.md

**Files:**
- Modify: `.github/workflows/deploy-supabase.yml`
- Modify: `CLAUDE.md`

**Step 1: Add dashboard deploy to CI workflow**

Change the deploy step to:
```yaml
      - name: Deploy Edge Functions
        run: |
          supabase functions deploy open-brain-mcp --no-verify-jwt
          supabase functions deploy open-brain-dashboard --no-verify-jwt
```

**Step 2: Add agent bus section to CLAUDE.md**

After the "When to Capture" subsection, add the agent bus documentation covering: topic channel conventions, monitoring tools, and how to register new agents.

**Step 3: Remove unused `MCP_ACCESS_KEY` secret**

Run: `supabase secrets unset MCP_ACCESS_KEY`

**Step 4: Commit and push**

```bash
git add .github/workflows/deploy-supabase.yml CLAUDE.md
git commit -m "docs: add agent bus conventions, update CI to deploy dashboard"
git push
```

**Step 5: Verify CI**

Run: `gh run list -R niemesrw/openbrain -L 1`
Expected: "Deploy Supabase" workflow triggered and passing.
