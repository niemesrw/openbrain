# Open Brain

This repo implements the [Open Brain guide](https://promptkit.natebjones.com/20260224_uq1_guide_main) by Nate B. Jones.

## Repo Purpose

Everything a user needs to set up their own Open Brain on AWS.

- `cdk/` — CDK stacks: S3 Vectors, DynamoDB, Cognito auth, API Gateway + Lambda, Web (S3 + CloudFront)
- `lambda/` — MCP server with S3 Vectors storage, Bedrock embeddings/metadata
- `web/` — React SPA dashboard (search, browse, feed, agent activity)
- `cli/` — Claude Code CLI extension
- Index-per-scope design: `private-{userId}` + `shared` indexes
- `skills/` — Pre-built instructions for each AI client
- `google-meet/` — Optional Google Meet summary ingestion

## Claude Code Skill

You have access to a personal knowledge base called Open Brain via MCP. It stores thoughts, decisions, notes, and memories as vector embeddings with semantic search.

### Available Tools

- `search_thoughts` — Search by meaning (not keywords). Use for any question about past decisions, people, projects, or context.
- `browse_recent` — See recent thoughts chronologically. Filter by type or topic.
- `stats` — Overview of the brain: totals, types, topics, people mentioned.
- `capture_thought` — Save something to the brain. Use when the user makes a decision, shares an insight, or says "remember this."
- `update_thought` — Edit an existing thought. Re-embeds and re-extracts metadata.
- `delete_thought` — Remove a thought by ID. Ownership is verified via `user_id`.

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
- `bus_activity` scans the shared S3 Vectors index and aggregates results in the Lambda.

**Topic channels (convention):**
- Use `channel:` prefix for bus-oriented topics: `channel:deploys`, `channel:security`, `channel:research`
- Regular topics (`Flutter`, `AWS`) remain for personal thoughts
- Agents "subscribe" by searching/browsing with a topic filter

**Web dashboard:**
- React SPA in `web/` — deployed via CDK (S3 + CloudFront)
- Shows agent activity, per-agent breakdown, and recent thoughts timeline
- Auto-refreshes every 30 seconds
- **Auth:** Cognito JWT with Google OAuth sign-in

**Registering a new agent:**
Use the `create_agent` / `list_agents` / `revoke_agent` MCP tools, or manage via the DynamoDB `agent_keys` table.

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

## AWS CLI

Always use `--profile blanxlait-ai` for all AWS CLI commands in this repo.

## Infrastructure

### AWS Accounts (BLANXLAIT org)

| Account | ID | Purpose |
|---------|-----|---------|
| Management | `982682372189` | Org root, CDK bootstrap, OIDC provider |
| AI (blanxlait-ai) | `057122451218` | **Production deployment target** |
| Log Archive | `779315395440` | SecurityLake |
| Security | `429971481640` | Security tooling |

**Region:** `us-east-1`

### GitHub Actions OIDC Auth

Deployments use a two-hop auth flow (defined in `blanxlait-aws-infra`):
1. GitHub OIDC → `arn:aws:iam::982682372189:role/GitHubActionsRole` (management account)
2. Assume role → `arn:aws:iam::057122451218:role/GitHubDeployRole` (AI account, AdministratorAccess)

Trust policy scoped to `repo:BLANXLAIT/*:*`.

### Google OAuth

- **GCP Project:** `560120385866` / `openbrain-490609`
- Google client secret must be stored in AWS Secrets Manager in the AI account (`057122451218`)
- CDK reads the secret ARN at deploy time via `-c googleClientSecretArn=<ARN>`
- The Google Client ID is passed via `-c googleClientId=<ID>`

### Self-Hosted Runners

The org has self-hosted GitHub Actions runners (macOS ARM64, Linux ARM64).
Use `runs-on: self-hosted` in workflows targeting these runners.

## Development Notes

Uses S3 Vectors with an index-per-scope design. The `shared` index is created by CDK at deploy time. Private user indexes (`private-{userId}`) are created on-demand at first capture via the Lambda. No database migrations needed — S3 Vectors is schemaless.

**Scoping model:**
- `scope: "private"` (default) — reads/writes to `private-{userId}` index
- `scope: "shared"` — reads/writes to the `shared` index
- `scope: "all"` — queries both indexes, merges results

**Deploy:** `cd cdk && npx cdk deploy --all` (or via GitHub Actions — see CI/CD below)

## CI/CD

### Deploy (`.github/workflows/deploy.yml`)

Triggered on push to `main`. Deploys all 5 CDK stacks to the AI account (`057122451218`). Uses OIDC → management account → cross-account assume role to AI account. Requires GitHub secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET_ARN`, and `CLOUDFRONT_CALLBACK_URL` (set after first deploy).

### Integration Tests (`.github/workflows/integration-tests.yml`)

Manual-only (`workflow_dispatch`). Uses OIDC to AWS management account to fetch test credentials from Secrets Manager, then runs the integration test suite in `tests/`.

## MCP OAuth

The server implements the MCP Authorization spec (OAuth 2.1 discovery, Dynamic Client Registration, authorization/token proxying) so MCP clients can authenticate automatically via Google OAuth without manual token management.

**Key files:**
- `lambda/src/oauth.ts` — OAuth Lambda handler (discovery, auth proxy, DCR)
- `lambda/src/oauth/cimd.ts` — Client ID Metadata Document validation + SSRF protection
- `lambda/src/auth/verify.ts` — Shared JWT + API key verification (used by MCP Lambda and authorizer)

**Reference implementation:** [empires-security/mcp-oauth2-aws-cognito](https://github.com/empires-security/mcp-oauth2-aws-cognito) — our OAuth implementation was modeled after this repo, which demonstrates provider-agnostic OAuth 2.1 for MCP servers with Cognito. Refer to it for additional context on DCR bridging, CIMD flows, and the authorization proxy pattern.

## PR Checklist

Before submitting a pull request, ensure:

1. **Tests** — New Lambda handlers must have unit tests in `lambda/src/handlers/__tests__/`. Run `cd lambda && npm test` to verify all tests pass.
2. **New routes** — Any new API route must be wired in both `lambda/src/index.ts` (handler + auth) and `cdk/lib/stacks/api-stack.ts` (HTTP API route).
3. **Performance** — Routes on hot paths (e.g., dashboard load) must not add additional full-index `listAllVectors` scans without a caching strategy. Copilot will flag these.
4. **Error handling** — Use `err instanceof Error ? err.message : String(err)` when logging errors to handle non-Error throws correctly.
5. **Web build** — If `web/` files changed, run `cd web && npm run build` to ensure the SPA builds cleanly before deploying via CDK.

## Troubleshooting

If tools return errors, check CloudWatch Logs for the Lambda function. Common issues:
- **Bedrock model access:** Ensure Titan Embed v2 and the Claude Haiku model are enabled in your region
- **S3 Vectors permissions:** The Lambda role needs `s3vectors:*` on the vector bucket
- **`AccessDeniedException` from Bedrock with a cross-region model:** Cross-region inference profiles (e.g. `us.anthropic.claude-haiku-4-5-20251001-v1:0`) require the IAM policy to grant access to both the inference profile ARN *and* the underlying foundation model ARNs in each routable region. The profile ARN alone is not sufficient. See `api-stack.ts` for the required ARN set.
