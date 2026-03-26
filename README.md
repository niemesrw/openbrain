# Open Brain

One database that every AI you use shares as persistent memory. Claude, ChatGPT, Gemini, Cursor — one brain, all of them.

## What You Get

- **Semantic search** — Find thoughts by meaning ("career changes" matches "Sarah is leaving her job")
- **Capture from anywhere** — Any connected AI can save thoughts directly
- **Memory migration** — Pull memories out of ChatGPT, Claude, and Gemini into one shared brain
- **Skills for each AI** — Pre-built instructions that teach each client how to use the brain

## Architecture

```
Claude Code ──┐
Claude Desktop ┼── MCP ──→ API Gateway + Lambda ──→ S3 Vectors
ChatGPT ───────┤                    ↕
Gemini CLI ────┘                  Bedrock
                             (embed + classify)
```

Fully serverless — Lambda + S3 Vectors + Bedrock + Cognito. Org-level sharing with JWT auth.

> **Legacy Supabase docs:** Some files in this repo (`openbrain-guide.md`, `slack/SETUP.md`) still reference an older Supabase/Deno deployment path. These are deprecated — use the AWS instructions below.

### Cost

| Service | Cost |
|---------|------|
| S3 Vectors | Pay-per-use (pennies/month for personal use) |
| Lambda + API Gateway | Pay-per-request |
| Bedrock (Titan Embed v2 + Haiku metadata) | ~$0.10–0.50/month |
| Cognito | Free tier covers 50K MAU |

### Prerequisites

- AWS account with CDK bootstrapped (`npx cdk bootstrap`)
- Node.js 20+
- Bedrock model access enabled: **Titan Embed Text v2** and **Claude Haiku 4.5** (cross-region inference profile)

### 1. Clone and deploy

```bash
git clone https://github.com/niemesrw/openbrain.git
cd openbrain/cdk
npm install
npx cdk deploy --all
```

This creates three stacks:

| Stack | What it creates |
|-------|----------------|
| `EnterpriseBrainVectors` | S3 vector bucket + `shared` index |
| `EnterpriseBrainAuth` | Cognito user pool (org email domain enforcement) |
| `EnterpriseBrainApi` | API Gateway (JWT) + Lambda MCP server |

The API URL is printed at the end of the deploy.

### 2. Create a user

```bash
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_POOL_ID \
  --username you@yourorg.com \
  --temporary-password TempPass1!

aws cognito-idp admin-set-user-password \
  --user-pool-id YOUR_POOL_ID \
  --username you@yourorg.com \
  --password YourPassword1! \
  --permanent
```

### 3. Connect Your AIs

Get a token:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLI_CLIENT_ID \
  --auth-parameters USERNAME=you@yourorg.com,PASSWORD=YourPassword1!
```

Use the `IdToken` as a Bearer token in all MCP client configs.

#### Claude Code

```bash
claude mcp add --transport http open-brain \
  https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp \
  --header "Authorization: Bearer YOUR_ID_TOKEN"
```

#### Claude Desktop

1. Settings → Connectors → **Add custom connector**
2. Name: `Open Brain`
3. URL: `https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp`
4. Auth: Bearer token → paste your `IdToken`
5. Paste `skills/claude-desktop.md` into Project Instructions

#### ChatGPT (paid plans)

1. Settings → Apps & Connectors → Advanced settings → **Developer Mode ON**
2. Settings → Apps & Connectors → **Create**
3. Name: `Open Brain`, URL: your API URL, Auth: Bearer token
4. Copy `skills/chatgpt-instructions.md` into Custom Instructions or a Custom GPT

#### Gemini CLI

```bash
gemini mcp add -t http open-brain \
  https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp \
  -H "Authorization: Bearer YOUR_ID_TOKEN"
```

#### Other MCP Clients (Cursor, VS Code, Windsurf)

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp",
        "--header",
        "Authorization: Bearer ${BRAIN_TOKEN}"
      ],
      "env": {
        "BRAIN_TOKEN": "your-id-token"
      }
    }
  }
}
```

### AWS Architecture

**Vector storage:** One S3 vector bucket with index-per-scope design:
- `private-{userId}` — created on-demand at first capture, only you can see it
- `shared` — org-wide, anyone in the user pool can read/write

**Scoping:** Each tool accepts a `scope` parameter:
- `private` (default) — your thoughts only
- `shared` — org-wide shared thoughts
- `all` — both private and shared, merged

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_thoughts` | Semantic search — finds thoughts by meaning |
| `browse_recent` | Browse chronologically, filter by type or topic |
| `stats` | Overview — total thoughts, types, topics, people |
| `capture_thought` | Save a thought from any connected AI |

---

## Migrate Your Memories

After connecting, migrate your existing memories into the brain. Each skill includes migration instructions. Here's the overview:

**From ChatGPT:**
1. Settings → Personalization → Memory → Manage → copy all memories
2. Paste into a connected AI and say: *"Migrate these into my Open Brain — capture each one individually"*

**From Claude Desktop:**
1. Settings → Memories → copy
2. Paste into a connected conversation: *"Capture each of these as separate thoughts in my brain"*

**From Claude Code:**
Tell Claude Code: *"Read my memory files (`~/.claude/memory/`) and migrate each piece of knowledge into Open Brain"*

**From Gemini (via Google Takeout):**
1. takeout.google.com → Deselect all → My Activity → All activity data included → deselect all → check Gemini Apps only → Create export
2. Open `Takeout/My Activity/Gemini Apps/MyActivity.html` in a browser
3. Paste relevant conversations into a connected AI for capture

---

## Skills

Pre-built instructions for each AI client — teach it to search before answering, capture proactively, and handle memory migration.

| File | For | How to Use |
|------|-----|------------|
| `CLAUDE.md` | Claude Code | Automatic — loaded when run from this directory |
| `GEMINI.md` | Gemini CLI | Automatic — loaded when run from this directory |
| `skills/claude-desktop.md` | Claude Desktop | Paste as Project Instructions |
| `skills/chatgpt-instructions.md` | ChatGPT | Custom GPT or Custom Instructions |
| `skills/gemini-gem.md` | Gemini Web | Create a Gem (no MCP support yet) |

---

## Optional Add-ons

### Slack Capture

A Slack channel for quick-capture without opening an AI. See [`slack/SETUP.md`](slack/SETUP.md).

### Google Meet Ingestion

Automatically captures Gemini-generated meeting summaries as shared thoughts. See [`google-meet/README.md`](google-meet/README.md).

---

## Troubleshooting

**401 errors** — Token expired. Cognito tokens last 8 hours (CLI client) or 1 hour (web client). Re-authenticate and update your client config.

**Bedrock `AccessDeniedException` with cross-region model** — Cross-region inference profiles require the IAM policy to grant access to both the inference profile ARN *and* the underlying foundation model ARNs in each routable region. See `cdk/lib/stacks/api-stack.ts` for the required ARN set.

**S3 Vectors permission errors** — IAM resource ARNs for S3 Vectors use `bucket/` prefix, NOT `vector-bucket/`. Check the policy in `api-stack.ts`.

**Lambda logs** — CloudWatch → Log groups → `/aws/lambda/EnterpriseBrainApi-McpHandler*`

---

## Project Structure

```
openbrain/
├── cdk/                            # AWS CDK infrastructure
│   ├── bin/
│   │   └── enterprise-brain.ts
│   └── lib/stacks/
│       ├── vector-storage-stack.ts  # S3 vector bucket + shared index
│       ├── auth-stack.ts           # Cognito user pool
│       └── api-stack.ts            # API Gateway + Lambda
├── lambda/                         # AWS Lambda MCP server
│   └── src/
│       ├── index.ts                # MCP protocol handler
│       ├── auth/context.ts         # JWT context extraction
│       ├── handlers/               # search, browse, capture, stats
│       └── services/
│           ├── vectors.ts          # S3 Vectors client
│           ├── embeddings.ts       # Bedrock Titan Embed v2
│           └── metadata.ts         # Bedrock Claude Haiku 4.5
├── openbrain-guide.md              # Legacy Supabase/OpenRouter setup guide (deprecated)
├── skills/                         # AI client instructions
├── google-meet/                    # Optional: Google Meet ingestion
├── slack/                          # Optional: Slack capture channel
└── tests/                          # Integration tests (vitest)
```

---

## Credits

The Open Brain concept and MCP server design are the work of [Nate B. Jones](https://www.youtube.com/@DoingAIDifferently). His [original video](https://www.youtube.com/watch?v=2JiMmye2ezg) and [Substack newsletter](https://natesnewsletter.substack.com/) walk through the philosophy. This repo implements the idea on AWS serverless infrastructure (S3 Vectors, Bedrock, Cognito) — one brain, every AI.
