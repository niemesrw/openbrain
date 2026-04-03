#!/usr/bin/env bash
# Refreshes the Stitch MCP access token in ~/.claude.json
# Run this when Stitch MCP stops responding (tokens expire ~1 hour)

set -euo pipefail

CLAUDE_JSON="$HOME/.claude.json"

echo "Fetching fresh token from gcloud..."
TOKEN=$(gcloud auth application-default print-access-token)

echo "Updating ~/.claude.json..."
# Use python3 for safe JSON editing (avoids sed mangling special chars in tokens)
python3 - <<EOF
import json, sys

path = "$CLAUDE_JSON"
with open(path) as f:
    config = json.load(f)

config["mcpServers"]["stitch"]["headers"]["Authorization"] = "Bearer $TOKEN"

with open(path, "w") as f:
    json.dump(config, f, indent=2)

print("Token updated.")
EOF

echo ""
echo "Done. Restart Claude Code for the new token to take effect."
