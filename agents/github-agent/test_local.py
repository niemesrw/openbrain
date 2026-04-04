"""
Local smoke test for the GitHub agent.

Prerequisites:
  1. AWS credentials configured with access to Bedrock and S3 Vectors
  2. VECTOR_BUCKET_NAME env var set
  3. pip install -r requirements.txt
  4. Agent running: python agent.py (in another terminal)

Usage:
  # Test with a PR event
  python test_local.py pr

  # Test with a push event
  python test_local.py push

  # Test with a release event
  python test_local.py release

  # Or hit the running agent directly
  curl -X POST http://localhost:8080/invocations \
    -H "Content-Type: application/json" \
    -d @test_payloads/pr_opened.json
"""

import json
import sys
import urllib.request

BASE_URL = "http://localhost:8080/invocations"
TEST_USER_ID = "test-user-local"

PAYLOADS = {
    "pr": {
        "eventType": "pull_request",
        "userId": TEST_USER_ID,
        "payload": {
            "action": "closed",
            "pull_request": {
                "number": 42,
                "title": "feat(agents): migrate github-agent to AgentCore Runtime",
                "body": "Replaces the TypeScript Lambda pipeline with a Python/Strands agent. "
                        "Adds semantic search before capture so insights are connected.",
                "html_url": "https://github.com/BLANXLAIT/openbrain/pull/42",
                "base": {"ref": "main"},
                "head": {"ref": "feat/agentcore-runtime"},
                "merged": True,
                "additions": 180,
                "deletions": 95,
                "changed_files": 6,
            },
            "sender": {"login": "ryanniem"},
            "repository": {"full_name": "BLANXLAIT/openbrain"},
        },
    },
    "push": {
        "eventType": "push",
        "userId": TEST_USER_ID,
        "payload": {
            "ref": "refs/heads/main",
            "pusher": {"name": "ryanniem"},
            "compare": "https://github.com/BLANXLAIT/openbrain/compare/abc123...def456",
            "commits": [
                {"message": "fix(security): pin jsondiffpatch >=0.7.2 to fix XSS"},
                {"message": "chore: update lockfile"},
            ],
            "repository": {"full_name": "BLANXLAIT/openbrain"},
        },
    },
    "release": {
        "eventType": "release",
        "userId": TEST_USER_ID,
        "payload": {
            "action": "published",
            "release": {
                "tag_name": "v1.4.0",
                "name": "v1.4.0 — AgentCore Runtime support",
                "prerelease": False,
                "html_url": "https://github.com/BLANXLAIT/openbrain/releases/tag/v1.4.0",
                "body": "Migrates GitHub agent to AgentCore Runtime with Strands. "
                        "Adds semantic search before capture. Real-time feed via SSE coming next.",
            },
            "sender": {"login": "ryanniem"},
            "repository": {"full_name": "BLANXLAIT/openbrain"},
        },
    },
}


def invoke(event_name: str) -> None:
    payload = PAYLOADS.get(event_name)
    if not payload:
        print(f"Unknown event '{event_name}'. Choose: {', '.join(PAYLOADS)}")
        sys.exit(1)

    print(f"\n→ Invoking agent with '{event_name}' event...\n")
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        print(resp.read().decode())


if __name__ == "__main__":
    event = sys.argv[1] if len(sys.argv) > 1 else "pr"
    invoke(event)
