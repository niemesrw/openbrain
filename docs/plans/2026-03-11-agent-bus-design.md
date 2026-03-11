# Agent Bus Design

Turn Open Brain into a shared communication bus for agents with per-agent identity, monitoring, and topic-based channels.

## Constraints

- Start simple, make extensible (few agents initially, grow over time)
- Equal access — all agents can read and write
- Monitoring via MCP tool and web dashboard
- Backward compatible with existing `x-brain-key` auth

## Schema

### `agent_keys` table

```sql
create table agent_keys (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null unique,
  api_key text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz default now()
);

-- RLS: service role only
alter table agent_keys enable row level security;
create policy "Service role full access"
  on agent_keys for all
  using (auth.role() = 'service_role');
```

Existing `MCP_ACCESS_KEY` is migrated as a row with `agent_name = 'personal'`.

### `bus_activity()` SQL function

Server-side aggregation of recent thoughts grouped by agent. Parameters: time window, optional agent filter, limit. Returns JSON with per-agent activity counts and recent messages.

## Edge Function Changes (`open-brain-mcp`)

### Auth

Replace env-var-based auth with table lookup:

1. Read `x-brain-key` from header or `key` query param
2. Look up key in `agent_keys` table
3. If found, return `agent_name`; if not, 401
4. `MCP_ACCESS_KEY` env var is removed

### Auto-tagging

On `capture_thought`, server injects `agent_id: <agent_name>` into the thought's metadata before saving. Agents don't need to pass it.

### New tool: `bus_activity`

- **Parameters:** `limit` (default 20), `agent` (optional filter), `hours` (default 24)
- **Returns:** recent thoughts with agent attribution, summary line ("5 agents active, 47 thoughts in last 24h")
- **Backed by:** `bus_activity()` SQL function

## Dashboard (`open-brain-dashboard`)

Separate Edge Function serving a single HTML page:

- Authenticated via `x-brain-key` query param (same key system)
- Shows: agent activity timeline, thoughts-per-agent counts, recent bus messages
- Auto-refreshes every 30s
- Calls `bus_activity()` SQL function — no duplicate logic
- Deployed alongside the MCP function

## Topics as Channels (Convention)

No code enforcement. Agents use topic prefixes for channels:

- `channel:deploys`, `channel:security`, `channel:research`
- Regular topics (`Flutter`, `AWS`) stay as-is for personal thoughts
- Agents "subscribe" by searching/browsing with a topic filter

Documented in CLAUDE.md. Enforcement deferred unless needed.

## Implementation Steps

1. Migration: `agent_keys` table + seed existing key + `bus_activity()` function
2. Edge Function: update auth, add auto-tagging, add `bus_activity` tool
3. Dashboard: new `open-brain-dashboard` Edge Function
4. Update CLAUDE.md with bus conventions
5. Test and deploy
