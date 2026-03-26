#!/usr/bin/env python3
"""
Parse a Google Takeout Gemini MyActivity.html export and prepare
conversations for migration into Open Brain.

Usage:
    python3 migrations/gemini-takeout.py <path-to-MyActivity.html>

This produces a JSON file (gemini-export.json) with extracted conversations.
Review the file, remove entries you don't want, then run with --capture:

    python3 migrations/gemini-takeout.py gemini-export.json --capture \
      --api-url https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp \
      --api-key ob_YOUR_API_KEY

Zero external dependencies — uses only the Python standard library.

How to get MyActivity.html:
    1. Go to takeout.google.com → click "Deselect all"
    2. Check "My Activity" (NOT "Gemini" — that only exports Gems)
    3. Click "All activity data included" → Deselect all → check only "Gemini Apps" → OK
    4. Create export → download zip → find: Takeout/My Activity/Gemini Apps/MyActivity.html
"""

import argparse
import html as html_module
import http.client
import json
import re
import ssl
import sys
from pathlib import Path
from urllib.parse import urlparse


def clean_html(text: str) -> str:
    """Strip HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_entries(html_content: str) -> list[dict]:
    """Extract conversation entries from MyActivity.html."""
    entries = []

    # Normalize various Unicode spaces to regular spaces
    html_content = html_content.replace("\xa0", " ")  # non-breaking space
    html_content = html_content.replace("\u202f", " ")  # narrow no-break space

    # Split on outer-cell boundaries
    blocks = html_content.split(
        'class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"'
    )

    for block in blocks[1:]:  # skip header
        entry = {}

        # Extract the user's prompt: "Prompted <text><br>"
        prompt_match = re.search(
            r'mdl-typography--body-1">\s*Prompted\s+(.*?)<br>',
            block,
        )
        if prompt_match:
            entry["prompt"] = clean_html(prompt_match.group(1))
        else:
            continue  # Skip non-prompt entries

        # Extract timestamp
        date_match = re.search(
            r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+, \d{4}, \d+:\d+:\d+ [AP]M \w+)',
            block,
        )
        if date_match:
            entry["date"] = date_match.group(1)

        # Extract Gemini's response — everything after the timestamp <br> tag
        # up to the right-column cell
        response_match = re.search(
            r'[AP]M \w+<br>(.*?)(?:<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"|$)',
            block,
            re.DOTALL,
        )
        if response_match:
            response_text = clean_html(response_match.group(1))
            if len(response_text) > 10:
                entry["response"] = response_text

        # Check if a Gem was used
        gem_match = re.search(r"([\w\s-]+) was used in this chat", block)
        if gem_match:
            entry["gem"] = gem_match.group(1).strip()

        if entry.get("prompt"):
            entries.append(entry)

    return entries


def format_thought(entry: dict) -> str:
    """Format an entry as a thought for capture."""
    parts = []
    if entry.get("date"):
        parts.append(f"[Gemini conversation, {entry['date']}]")
    if entry.get("gem"):
        parts.append(f"Gem: {entry['gem']}")
    parts.append(f"Prompt: {entry['prompt']}")
    if entry.get("response"):
        response = entry["response"]
        if len(response) > 1500:
            response = response[:1500] + "..."
        parts.append(f"Response: {response}")
    return "\n".join(parts)


def _post_json(host: str, path: str, body: bytes, headers: dict) -> dict:
    """Make an HTTPS POST request and return parsed JSON."""
    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection(host, timeout=30, context=ctx)  # nosemgrep: httpsconnection-detected
    try:
        conn.request("POST", path, body=body, headers=headers)
        resp = conn.getresponse()
        return json.loads(resp.read().decode("utf-8"))
    finally:
        conn.close()


def capture_to_brain(entries: list[dict], api_url: str, api_key: str) -> None:
    """Send thoughts to Open Brain via the MCP server."""
    parsed = urlparse(api_url)
    if parsed.scheme != "https":
        print("Error: API URL must use https://")
        sys.exit(1)

    host = parsed.hostname
    path = parsed.path

    captured = 0
    errors = 0
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
    }

    for i, entry in enumerate(entries):
        thought = format_thought(entry)
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": i + 1,
            "method": "tools/call",
            "params": {
                "name": "capture_thought",
                "arguments": {"text": thought},
            },
        }).encode("utf-8")

        try:
            result = _post_json(host, path, payload, headers)
            if "error" in result:
                print(f"  [{i+1}/{len(entries)}] Error: {result['error']['message']}", flush=True)
                errors += 1
            else:
                content = result.get("result", {}).get("content", [{}])
                text = content[0].get("text", "") if content else ""
                print(f"  [{i+1}/{len(entries)}] {text}", flush=True)
                captured += 1
        except Exception as e:
            print(f"  [{i+1}/{len(entries)}] Failed: {e}", flush=True)
            errors += 1

    print(f"\nDone: {captured} captured, {errors} errors", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Parse Gemini Takeout and migrate to Open Brain"
    )
    parser.add_argument(
        "input_file",
        help="Path to MyActivity.html (parse mode) or gemini-export.json (capture mode)",
    )
    parser.add_argument(
        "--capture",
        action="store_true",
        help="Capture from a reviewed JSON file (requires --api-url and --api-key, or API_URL/API_KEY env vars)",
    )
    parser.add_argument("--api-url", help="Open Brain API URL (e.g. https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp)")
    parser.add_argument("--api-key", help="Agent API key (starts with ob_)")
    parser.add_argument(
        "--output",
        default="gemini-export.json",
        help="Output JSON file (default: gemini-export.json)",
    )
    parser.add_argument(
        "--min-length",
        type=int,
        default=20,
        help="Skip prompts shorter than this (default: 20 chars)",
    )
    args = parser.parse_args()

    input_path = Path(args.input_file)
    if not input_path.exists():
        print(f"Error: {input_path} not found")
        sys.exit(1)

    # Capture mode: read reviewed JSON and send to brain
    if args.capture:
        import os

        api_url = args.api_url or os.environ.get("API_URL")
        api_key = args.api_key or os.environ.get("API_KEY")

        if not api_url or not api_key:
            print("Error: --capture requires API_URL and API_KEY")
            print("  Set via env vars or --api-url / --api-key flags")
            print("  Create an API key with: brain create-agent migration")
            sys.exit(1)

        entries = json.loads(input_path.read_text())
        print(f"Capturing {len(entries)} entries to brain...", flush=True)
        capture_to_brain(entries, api_url, api_key)
        return

    # Parse mode: extract from HTML and save JSON for review
    print(f"Reading {input_path}...", flush=True)
    content = input_path.read_text(encoding="utf-8")

    print("Parsing entries...", flush=True)
    entries = parse_entries(content)
    print(f"Found {len(entries)} conversation entries", flush=True)

    # Filter short/trivial prompts
    entries = [e for e in entries if len(e.get("prompt", "")) >= args.min_length]
    print(f"After filtering (>={args.min_length} chars): {len(entries)} entries", flush=True)

    # Reverse to chronological order (file is newest-first)
    entries.reverse()

    if entries:
        print(
            f"Date range: {entries[0].get('date', '?')} to {entries[-1].get('date', '?')}",
            flush=True,
        )

    # Save to JSON for review
    output_path = Path(args.output)
    output_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False))
    print(f"\nSaved to {output_path}", flush=True)
    print(f"\nNext steps:", flush=True)
    print(f"  1. Review {output_path} — remove entries you don't want to capture", flush=True)
    print(f"  2. Run: python3 {sys.argv[0]} {output_path} --capture --api-url <URL> --api-key <KEY>", flush=True)


if __name__ == "__main__":
    main()
