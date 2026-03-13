# Open Brain

This repo implements the [Open Brain guide](https://promptkit.natebjones.com/20260224_uq1_guide_main) by Nate B. Jones. The goal is to mirror the guide as closely as possible while automating setup via `setup.sh`.

## Repo Purpose

Everything a user needs to set up their own Open Brain. Two deployment paths:

**Supabase (free tier):**
- `setup.sh` — Automated setup: links Supabase, applies migrations, sets secrets, deploys functions
- `supabase/migrations/` — Database schema (pgvector, thoughts table, match_thoughts function)
- `supabase/functions/open-brain-mcp/` — MCP server (Edge Function)

**AWS Enterprise:**
- `cdk/` — CDK stacks: S3 Vectors, Cognito auth, API Gateway + Lambda
- `lambda/` — MCP server with S3 Vectors storage, Bedrock embeddings/metadata
- Index-per-scope design: `private-{userId}` + `shared` indexes

**Shared:**
- `slack/ingest-thought/` — Optional Slack capture add-on
- `skills/` — Pre-built instructions for each AI client

## Claude Code Skill

You have access to a personal knowledge base called Open Brain via MCP. It stores thoughts, decisions, notes, and memories as vector embeddings with semantic search.

### Available Tools

- `search_thoughts` — Search by meaning (not keywords). Use for any question about past decisions, people, projects, or context.
- `browse_recent` — See recent thoughts chronologically. Filter by type or topic.
- `stats` — Overview of the brain: totals, types, topics, people mentioned.
- `capture_thought` — Save something to the brain. Use when the user makes a decision, shares an insight, or says "remember this."

### Metadata Schema

Follows the guide's 5-type schema:
- **type**: one of `observation`, `task`, `idea`, `reference`, `person_note`
- **topics**: array of 1-3 short topic tags
- **people**: array of people mentioned
- **action_items**: array of implied to-dos
- **dates_mentioned**: array of dates (YYYY-MM-DD)

### When to Search

Before answering questions about:
- Past decisions ("what did we decide about...")
- People ("what do I know about Sarah...")
- Projects ("what's the status of...")
- Preferences ("how do I usually handle...")
- Context from previous sessions

Search first, then incorporate what you find into your response.

### When to Capture

Proactively offer to capture:
- Architectural decisions
- Bug fixes and their root causes
- Project preferences and conventions
- Important context about people or teams
- Action items and follow-ups

Ask before capturing unless the user explicitly says "remember" or "save this."

### Agent Bus

Open Brain doubles as a shared communication bus for agents. Each agent gets its own API key, and every captured thought is auto-tagged with the agent's identity.

**Available Tools:**
- `bus_activity` — Monitor bus activity: recent thoughts grouped by agent, activity counts, and timeline. Supports `hours`, `agent` (filter), and `limit` parameters.

**How it works:**
- Per-agent keys are stored in the `agent_keys` table. Auth looks up the key to identify the agent.
- On `capture_thought`, the server injects `agent_id` into metadata automatically — agents don't pass it.
- `bus_activity` calls a server-side SQL function for efficient aggregation.

**Topic channels (convention):**
- Use `channel:` prefix for bus-oriented topics: `channel:deploys`, `channel:security`, `channel:research`
- Regular topics (`Flutter`, `AWS`) remain for personal thoughts
- Agents "subscribe" by searching/browsing with a topic filter

**Web dashboard:**
- `dashboard.html` — standalone HTML file, serve locally (`python3 -m http.server 8787`)
- Connects to the `open-brain-dashboard` Edge Function (JSON API) for data
- Shows agent activity, per-agent breakdown, and recent thoughts timeline
- Auto-refreshes every 30 seconds
- **Auth:** GitHub/Google OAuth via Supabase Auth, or API key fallback
- First visit requires `?anon_key=<supabase-anon-key>` URL param (saved to localStorage)
- OAuth providers configured in Supabase Dashboard → Authentication → Providers

**Registering a new agent:**
```sql
insert into agent_keys (agent_name) values ('my-agent');
-- api_key is auto-generated; retrieve it:
select agent_name, api_key from agent_keys where agent_name = 'my-agent';
```

## Memory Migration

Memory migration is powered by [Nate B. Jones' migration prompts](https://nateb.jones.com) (available on his Substack). When the user asks to migrate memories, help them export from their current AI tools and capture each memory into the brain:

### From Claude Code
Claude Code stores memories in `~/.claude/memory/` files and project-level `CLAUDE.md` files. To migrate:

1. Read the memory files and CLAUDE.md
2. For each distinct piece of knowledge (decision, preference, fact), call `capture_thought` with the content
3. Summarize what was migrated

### From Claude Desktop
Claude Desktop stores memories that the user can view in Settings → Memories. The user should:

1. Copy their memories from Claude Desktop settings
2. Paste them into this conversation
3. You'll capture each one into the brain

### From ChatGPT
ChatGPT stores memories viewable at Settings → Personalization → Memory. The user should:

1. Go to ChatGPT Settings → Personalization → Memory → Manage
2. Copy/export their memories
3. Paste them here
4. You'll capture each one into the brain

### From Gemini
Gemini doesn't store discrete memories, but full conversation history is exportable via Google Takeout. **Important:** export "My Activity", not "Gemini" (that only gives you Gems).

1. takeout.google.com → Deselect all → check "My Activity" → click "All activity data included" → Deselect all → check only "Gemini Apps" → OK → Create export
2. In the zip: `Takeout/My Activity/Gemini Apps/MyActivity.html` — open in browser, use Ctrl+F to find specific topics
3. Paste the most valuable conversations here for capture

Also check for custom instructions at Settings → Personal Intelligence → Instructions for Gemini.

### From Personal Data (Spotify, Amazon, etc.)
The brain can store any personal context. Have the user export data from services, review for patterns/preferences worth remembering, and paste the relevant parts here for capture. Examples: listening habits, purchase patterns, favorite places, dietary preferences.

After migration, suggest the user test by asking a different AI client about something that was just migrated.

## Development Notes

### Supabase Path

Migrations are in `supabase/migrations/`. The initial schema is in `20260306000000_initial_schema.sql`. Additional migrations add server-side functions (e.g. `stats_summary()` for aggregation without PostgREST row limits).

### AWS Enterprise Path

Uses S3 Vectors with an index-per-scope design. The `shared` index is created by CDK at deploy time. Private user indexes (`private-{userId}`) are created on-demand at first capture via the Lambda. No database migrations needed — S3 Vectors is schemaless.

**Scoping model:**
- `scope: "private"` (default) — reads/writes to `private-{userId}` index
- `scope: "shared"` — reads/writes to the `shared` index
- `scope: "all"` — queries both indexes, merges results

**Deploy:** `cd cdk && npx cdk deploy --all`

## CI/CD

### Supabase Deploy (`.github/workflows/deploy-supabase.yml`)

Runs automatically on push to `main` when files change in `supabase/migrations/` or `supabase/functions/`. Pushes migrations and deploys Edge Functions using the Supabase CLI.

**Required GitHub secrets:**
- `SUPABASE_ACCESS_TOKEN` — Personal access token from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
- `SUPABASE_PROJECT_REF` — Supabase project reference ID

### Integration Tests (`.github/workflows/integration-tests.yml`)

Manual-only (`workflow_dispatch`). Uses OIDC to AWS management account to fetch test credentials from Secrets Manager, then runs the integration test suite in `tests/`.

### Local Deploy

You can still deploy manually:
```bash
supabase db push
supabase functions deploy open-brain-mcp --no-verify-jwt
supabase functions deploy open-brain-dashboard --no-verify-jwt
```

## Troubleshooting

**Supabase path:** If the MCP server shows "failed" or won't connect, the most common cause is a **key mismatch**. Running `setup.sh` again (or regenerating the key during setup) updates the Supabase secret but does not update AI client configs. Compare the key in the client config against `.setup-state` or the setup script output — they must match.

**AWS Enterprise path:** If tools return errors, check CloudWatch Logs for the Lambda function. Common issues:
- **Bedrock model access:** Ensure Titan Embed v2 and the Claude Haiku model are enabled in your region
- **S3 Vectors permissions:** The Lambda role needs `s3vectors:*` on the vector bucket
- **`AccessDeniedException` from Bedrock with a cross-region model:** Cross-region inference profiles (e.g. `us.anthropic.claude-haiku-4-5-20251001-v1:0`) require the IAM policy to grant access to both the inference profile ARN *and* the underlying foundation model ARNs in each routable region. The profile ARN alone is not sufficient. See `api-stack.ts` for the required ARN set.
