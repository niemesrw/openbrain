# Open Brain — Gemini CLI Skill

You have access to a personal knowledge base called Open Brain via MCP. It stores thoughts, decisions, notes, and memories as vector embeddings with semantic search.

## Available Tools

- `search_thoughts` — Search by meaning (not keywords). Use for any question about past decisions, people, projects, or context.
- `browse_recent` — See recent thoughts chronologically. Filter by type or topic.
- `stats` — Overview of the brain: totals, types, topics, people mentioned.
- `capture_thought` — Save something to the brain. Use when the user makes a decision, shares an insight, or says "remember this."
- `update_thought` — Edit an existing thought. Re-embeds and re-extracts metadata.
- `delete_thought` — Remove a thought by ID. Ownership is verified via `user_id`.

## When to Search

Before answering questions about:
- Past decisions ("what did we decide about...")
- People ("what do I know about Sarah...")
- Projects ("what's the status of...")
- Preferences ("how do I usually handle...")
- Context from previous sessions

Search first, then incorporate what you find into your response.

## When to Capture

Proactively offer to capture:
- Architectural decisions
- Bug fixes and their root causes
- Project preferences and conventions
- Important context about people or teams
- Action items and follow-ups

Ask before capturing unless the user explicitly says "remember" or "save this."

## Memory Migration

When the user asks to migrate memories, help them export from their current AI tools and capture each memory into the brain:

### From Gemini
Gemini doesn't store discrete memories, but full conversation history is exportable via Google Takeout. **Important:** export "My Activity", not "Gemini" (that only gives you Gems).

1. takeout.google.com → Deselect all → check "My Activity" → click "All activity data included" → Deselect all → check only "Gemini Apps" → OK → Create export
2. In the zip: `Takeout/My Activity/Gemini Apps/MyActivity.html` — open in browser, use Ctrl+F to find specific topics
3. Paste the most valuable conversations here for capture

Also check for custom instructions at Settings → Personal Intelligence → Instructions for Gemini.

### From ChatGPT
ChatGPT stores memories viewable at Settings → Personalization → Memory. The user should:

1. Go to ChatGPT Settings → Personalization → Memory → Manage
2. Copy/export their memories
3. Paste them here
4. You'll capture each one into the brain

### From Claude Desktop
Claude Desktop stores memories that the user can view in Settings → Memories. The user should:

1. Copy their memories from Claude Desktop settings
2. Paste them into this conversation
3. You'll capture each one into the brain

### From Claude Code
Claude Code stores memories in `~/.claude/memory/` files and project-level `CLAUDE.md` files. The user should:

1. Tell Claude Code: "Read my memory files and migrate each piece of knowledge into Open Brain"
2. Or copy/paste the contents here for capture

### From Personal Data (Spotify, Amazon, etc.)
The brain can store any personal context. Export data from services, review for patterns/preferences worth remembering, and paste the relevant parts here for capture.

After migration, suggest the user test by asking a different AI client about something that was just migrated.

## Troubleshooting

If tools return errors, check CloudWatch Logs for the Lambda function. Common issues:
- **401 errors** — Token expired. Cognito CLI tokens last 8 hours. Re-authenticate and update your client config.
- **Bedrock `AccessDeniedException`** — Ensure Titan Embed v2 and Claude Haiku 4.5 are enabled in your region. Cross-region inference profiles require IAM access to both the profile ARN and underlying model ARNs.
- **S3 Vectors permission errors** — Check the Lambda role has `s3vectors:*` on the vector bucket.
