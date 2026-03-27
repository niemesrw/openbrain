# Open Brain

One database that every AI you use shares as persistent memory. Claude, ChatGPT, Gemini, Cursor — one brain, all of them.

## What You Get

- **Semantic search** — Find thoughts by meaning ("career changes" matches "Sarah is leaving her job")
- **Capture from anywhere** — Any connected AI can save thoughts directly
- **Memory migration** — Pull memories out of ChatGPT, Claude, and Gemini into one shared brain
- **Skills for each AI** — Pre-built instructions that teach each client how to use the brain

## Architecture

```
Claude Code ──┐                                        ┌── S3 Vectors
Claude Desktop ┼── MCP ──→ API Gateway + Lambda ──────┤
ChatGPT ───────┤              ↕            ↕           └── DynamoDB
Gemini CLI ────┘          Cognito       Bedrock            (agent keys)
                       (JWT + OAuth)  (embed + classify)
Web Dashboard ────────────────┘
```

Fully serverless — Lambda + S3 Vectors + Bedrock + Cognito + DynamoDB + CloudFront. Org-level sharing with JWT auth and Google OAuth.

### Cost

| Service | Cost |
|---------|------|
| S3 Vectors | Pay-per-use (pennies/month for personal use) |
| Lambda + API Gateway | Pay-per-request |
| Bedrock (Titan Embed v2 + Haiku metadata) | ~$0.10–0.50/month |
| DynamoDB | Pay-per-request (agent keys, user profiles) |
| Cognito | Free tier covers 50K MAU |
| CloudFront + S3 | Minimal (static web dashboard) |

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

This creates five stacks:

| Stack | What it creates |
|-------|----------------|
| `EnterpriseBrainVectors` | S3 vector bucket + `shared` index |
| `EnterpriseBrainAuth` | Cognito user pool + Google OAuth |
| `EnterpriseBrainData` | DynamoDB tables (agent keys, user profiles, DCR clients) |
| `EnterpriseBrainApi` | API Gateway + Lambda MCP server + OAuth discovery/proxy |
| `EnterpriseBrainWeb` | S3 + CloudFront web dashboard |

The API URL is printed at the end of the deploy.

### 2. Connect Your AIs

The MCP server supports OAuth 2.1 with automatic discovery — MCP clients handle authentication automatically. Just point them at the endpoint and sign in with Google when prompted.

#### Claude Code

```bash
claude mcp add --transport http open-brain https://YOUR_DOMAIN/mcp
```

Claude Code discovers OAuth automatically, opens your browser for Google sign-in, and stores tokens securely.

#### Claude Desktop

1. Settings → Connectors → **Add custom connector**
2. Name: `Open Brain`
3. URL: `https://YOUR_DOMAIN/mcp`
4. Paste `skills/claude-desktop.md` into Project Instructions

#### Gemini CLI

```bash
gemini mcp add -t http open-brain https://YOUR_DOMAIN/mcp
```

#### Other MCP Clients (Cursor, VS Code, Windsurf)

```json
{
  "mcpServers": {
    "open-brain": {
      "command": "npx",
      "args": ["mcp-remote", "https://YOUR_DOMAIN/mcp"]
    }
  }
}
```

#### Manual token (API key auth)

For clients that don't support OAuth discovery, create an agent API key via the `create_agent` tool, then pass it as a header:

```bash
claude mcp add --transport http open-brain \
  https://YOUR_DOMAIN/mcp \
  --header "X-Api-Key: ob_YOUR_API_KEY"
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
| `update_thought` | Edit an existing thought (re-embeds + re-extracts metadata) |
| `delete_thought` | Remove a thought by ID (ownership verified) |
| `create_agent` | Register a new agent and generate an API key |
| `list_agents` | Show all agents for the authenticated user |
| `revoke_agent` | Disable an agent's API key |
| `bus_activity` | Monitor shared feed — activity grouped by agent |

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

### Telegram Bot

Capture thoughts, search, browse, and get insights from Telegram — full feature parity with the web dashboard.

#### 1. Create a bot with BotFather

```
/newbot → follow prompts → copy the bot token
```

#### 2. Store the token in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name openbrain/telegram/bot-token \
  --secret-string "YOUR_BOT_TOKEN_HERE"
# Add --profile <your-aws-profile> if needed
```

Copy the secret ARN from the output.

#### 3. Deploy with the Telegram bot token ARN

```bash
cd cdk
npx cdk deploy --all \
  -c googleClientId=... \
  -c googleClientSecretArn=... \
  -c telegramBotTokenSecretArn=arn:aws:secretsmanager:us-east-1:...
```

This deploys `EnterpriseBrainTelegram` (new stack) which adds a `/webhook/telegram` route to the existing API.

#### 4. Register the webhook

After deploy, get the webhook URL from CDK outputs (`TelegramWebhookUrl`) and the webhook secret ARN (`TelegramWebhookSecretArn`), then register:

```bash
# Get the webhook secret value
WEBHOOK_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id arn:aws:secretsmanager:us-east-1:... \
  --query SecretString --output text)
# Add --profile <your-aws-profile> if needed

# Register with Telegram
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"<WEBHOOK_URL>\", \"secret_token\": \"$WEBHOOK_SECRET\"}"
```

#### 5. Link your account

1. Open the web dashboard → click **Connect Telegram** → generate a code
2. Send `/link <code>` to your bot in Telegram
3. Done — your bot is now connected to your brain

#### Bot commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + link instructions |
| `/link <code>` | Link your Telegram account |
| `/capture <text>` | Save a private thought |
| `/search <query>` | Semantic search |
| `/browse` | Last 5 recent thoughts |
| `/insight` | Surface a proactive insight |
| *(plain text)* | Captures as private thought |

#### 6. Set bot description in BotFather (optional)

Makes it easy for users to know what the bot does before they start it. Send these to [@BotFather](https://t.me/BotFather):

**`/setdescription`** — shown on the bot's profile page:
```
Your personal Open Brain assistant. Capture thoughts, search your knowledge base, and surface insights — all from Telegram.
```

**`/setabouttext`** — shown in the chat list before the first message:
```
Capture and search your Open Brain knowledge base from Telegram.
```

**`/setcommands`** — registers commands for autocomplete:
```
start - Welcome + setup instructions
link - Link your account: /link <code>
capture - Save a thought: /capture <text>
search - Search your brain: /search <query>
browse - Show recent thoughts
insight - Surface a pattern or insight
```

### GitHub Integration

Automatically captures pull requests, pushes, and releases from any connected GitHub account or organization.

#### 1. Create a GitHub App

Go to your org's GitHub App settings and create an app with:
- **Webhook URL:** `https://YOUR_DOMAIN/webhooks/github`
- **Webhook secret:** any random string
- **Permissions:** Repository contents (read), Pull requests (read), Metadata (read)
- **Subscribe to events:** Pull request, Push, Release
- **Setup URL:** `https://YOUR_DOMAIN/github/callback`
- Check **"Redirect on update"**

#### 2. Store secrets in GitHub Actions

Add these repository secrets:

| Secret | Value |
|--------|-------|
| `GH_APP_ID` | Your GitHub App's numeric ID |
| `GH_APP_PRIVATE_KEY` | The app's private key (PEM) |
| `GH_APP_WEBHOOK_SECRET` | The webhook secret you chose |
| `GITHUB_APP_SLUG` | Your app's slug (e.g. `openbrain-agent`) |

The deploy pipeline automatically upserts the private key and webhook secret into Secrets Manager and injects the slug into the web build.

#### 3. Connect as a user

1. Open the web dashboard → **Settings**
2. Click **Connect GitHub**
3. Install the app on your account or organization
4. You'll be redirected back to the dashboard — the account appears in Settings automatically

GitHub activity (PRs, pushes, releases) now flows into your brain as private thoughts.

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
│       ├── auth-stack.ts           # Cognito user pool + Google OAuth
│       ├── data-stack.ts           # DynamoDB (agent keys, user profiles)
│       ├── api-stack.ts            # API Gateway + Lambda + authorizer
│       └── web-stack.ts            # S3 + CloudFront web dashboard
├── lambda/                         # AWS Lambda MCP server
│   └── src/
│       ├── index.ts                # MCP protocol handler
│       ├── auth/context.ts         # JWT context extraction
│       ├── handlers/               # search, browse, capture, update, delete, stats, agent-keys, bus-activity
│       └── services/
│           ├── vectors.ts          # S3 Vectors client
│           ├── embeddings.ts       # Bedrock Titan Embed v2
│           └── metadata.ts         # Bedrock Claude Haiku 4.5
├── web/                            # React SPA dashboard (Cognito + Google OAuth)
├── cli/                            # Claude Code CLI extension
├── skills/                         # AI client instructions
├── google-meet/                    # Optional: Google Meet ingestion
└── tests/                          # Integration tests (vitest)
```

---

## Credits

The Open Brain concept and MCP server design are the work of [Nate B. Jones](https://www.youtube.com/@DoingAIDifferently). His [original video](https://www.youtube.com/watch?v=2JiMmye2ezg) and [Substack newsletter](https://natesnewsletter.substack.com/) walk through the philosophy. This repo implements the idea on AWS serverless infrastructure (S3 Vectors, Bedrock, Cognito) — one brain, every AI.

The MCP OAuth implementation (discovery, DCR, authorization proxy) was modeled after [empires-security/mcp-oauth2-aws-cognito](https://github.com/empires-security/mcp-oauth2-aws-cognito), which demonstrates provider-agnostic OAuth 2.1 for MCP servers with Cognito as the backing authorization server.
