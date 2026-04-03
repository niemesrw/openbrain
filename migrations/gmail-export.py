#!/usr/bin/env python3
"""
Parse a Gmail mbox export and prepare insights for migration into Open Brain.

Usage:
    python3 migrations/gmail-export.py <path-to-All-mail.mbox>

This produces a JSON file (gmail-export.json) with summarized email patterns.
Review the file, remove entries you don't want, then run with --capture:

    python3 migrations/gmail-export.py gmail-export.json --capture \
      --api-url https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp \
      --api-key ob_YOUR_API_KEY

Zero external dependencies — uses only the Python standard library.

How to get your Gmail data:
    1. Go to takeout.google.com → click "Deselect all"
    2. Check "Mail" → choose "MBOX format"
    3. Create export → download zip → extract the .mbox file
"""

import argparse
import email
import email.utils
import http.client
import json
import mailbox
import re
import ssl
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


# Domains that are automated/marketing — not real contacts
NOISE_DOMAINS = {
    "facebookmail.com", "linkedin.com", "accounts.google.com",
    "youtube.com", "twitter.com", "x.com", "instagram.com",
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "mailer-daemon", "postmaster",
}

MARKETING_PATTERNS = re.compile(
    r"(newsletter|noreply|no-reply|donotreply|notification|alert|digest|"
    r"update|promo|marketing|campaign|unsubscribe|bounce|mailer-daemon|"
    r"postmaster|automated|auto-confirm|shipment-tracking|order-update)",
    re.IGNORECASE,
)

SPAM_SUBJECT_PATTERNS = re.compile(
    r"(free spins|you have won|claim your|casino|lottery|"
    r"account.*blocked|photos.*removed|deposit needed|"
    r"shopping cart for you|mystery box|timeshare eligible|"
    r"erectile|blood sugar|prostate|testicle)",
    re.IGNORECASE,
)


def is_noise_sender(addr: str) -> bool:
    """Check if an email address is automated/marketing noise."""
    addr_lower = addr.lower()
    local = addr_lower.split("@")[0] if "@" in addr_lower else ""
    domain = addr_lower.split("@")[1] if "@" in addr_lower else ""

    if any(n in addr_lower for n in NOISE_DOMAINS):
        return True
    if any(n in local for n in ["noreply", "no-reply", "donotreply", "no_reply"]):
        return True
    if MARKETING_PATTERNS.search(local):
        return True
    return False


def is_spam_subject(subject: str) -> bool:
    """Check if a subject line looks like spam."""
    return bool(SPAM_SUBJECT_PATTERNS.search(subject))


def extract_addr(header_value: str) -> str:
    """Extract just the email address from a header value."""
    if not header_value:
        return ""
    _, addr = email.utils.parseaddr(header_value)
    return addr.lower().strip()


def extract_all_addrs(header_value: str) -> list[str]:
    """Extract all email addresses from a header (handles comma-separated)."""
    if not header_value:
        return []
    pairs = email.utils.getaddresses([header_value])
    return [addr.lower().strip() for _, addr in pairs if addr]


def parse_date(date_str: str) -> datetime | None:
    """Parse email date header into naive UTC datetime."""
    if not date_str:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(str(date_str))
        # Normalize to naive datetime for consistent comparison
        if parsed.tzinfo is not None:
            from datetime import timezone
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        return None


def get_domain(addr: str) -> str:
    """Extract domain from email address."""
    return addr.split("@")[1] if "@" in addr else ""


def analyze_mbox(mbox_path: str, owner_email: str) -> dict:
    """Stream through mbox and build contact/pattern analysis."""
    mbox = mailbox.mbox(mbox_path)

    # Contacts: track bidirectional communication
    contact_sent_to = Counter()       # emails I sent to this person
    contact_received_from = Counter() # emails I received from this person
    contact_first_seen = {}
    contact_last_seen = {}

    # Service/subscription tracking
    service_domains = Counter()

    # Timeline
    messages_by_year_month = Counter()
    sent_by_year = Counter()
    received_by_year = Counter()

    # Per-contact subjects and year activity
    contact_subjects = defaultdict(list)  # addr -> list of subjects
    contact_years = defaultdict(Counter)  # addr -> {year: count}

    # Subject tracking for sent emails (what I write about)
    sent_subjects_by_year = defaultdict(list)
    sent_subjects = []

    total = 0
    spam_filtered = 0
    processed = 0

    print("Streaming mbox (this may take a few minutes for large files)...", flush=True)

    for i, msg in enumerate(mbox):
        if i % 10000 == 0 and i > 0:
            print(f"  ...processed {i} messages", flush=True)

        total += 1

        from_addr = extract_addr(msg.get("From", ""))
        to_addrs = extract_all_addrs(msg.get("To", ""))
        try:
            subject = str(msg.get("Subject", "") or "")
        except Exception:
            subject = ""
        date = parse_date(msg.get("Date", ""))
        labels = msg.get("X-Gmail-Labels", "") or ""

        if not from_addr or not date:
            continue

        # Skip spam by label or subject
        if "Spam" in labels or "Trash" in labels:
            spam_filtered += 1
            continue
        if is_spam_subject(subject):
            spam_filtered += 1
            continue

        processed += 1
        year_month = date.strftime("%Y-%m")
        messages_by_year_month[year_month] += 1

        is_sent = from_addr == owner_email or "Sent" in labels
        from_domain = get_domain(from_addr)

        year = date.strftime("%Y")
        clean_subject = re.sub(r"^(Re|Fwd|Fw):\s*", "", subject, flags=re.IGNORECASE).strip()

        if is_sent:
            sent_by_year[year] += 1
            # Track who I send to
            for to_addr in to_addrs:
                if to_addr == owner_email:
                    continue
                if not is_noise_sender(to_addr):
                    contact_sent_to[to_addr] += 1
                    contact_years[to_addr][year] += 1
                    if to_addr not in contact_first_seen or date < contact_first_seen[to_addr]:
                        contact_first_seen[to_addr] = date
                    if to_addr not in contact_last_seen or date > contact_last_seen[to_addr]:
                        contact_last_seen[to_addr] = date
                    if len(clean_subject) > 10 and len(contact_subjects[to_addr]) < 20:
                        contact_subjects[to_addr].append(clean_subject[:100])

            # Track sent subjects by year
            if len(clean_subject) > 10:
                sent_subjects_by_year[year].append(clean_subject[:100])
                sent_subjects.append({
                    "subject": clean_subject[:200],
                    "date": date.strftime("%Y-%m-%d"),
                    "to": to_addrs[:3],
                })
        else:
            # Received email
            received_by_year[year] += 1
            if not is_noise_sender(from_addr):
                contact_received_from[from_addr] += 1
                contact_years[from_addr][year] += 1
                if from_addr not in contact_first_seen or date < contact_first_seen[from_addr]:
                    contact_first_seen[from_addr] = date
                if from_addr not in contact_last_seen or date > contact_last_seen[from_addr]:
                    contact_last_seen[from_addr] = date
                if len(clean_subject) > 10 and len(contact_subjects[from_addr]) < 20:
                    contact_subjects[from_addr].append(clean_subject[:100])
            else:
                # Track as service/subscription
                service_domains[from_domain] += 1

    mbox.close()

    # Build contact profiles — people with bidirectional communication
    all_contacts = set(contact_sent_to.keys()) | set(contact_received_from.keys())
    contacts = []
    for addr in all_contacts:
        sent = contact_sent_to.get(addr, 0)
        received = contact_received_from.get(addr, 0)
        total_exchange = sent + received
        if total_exchange < 3:
            continue

        contacts.append({
            "email": addr,
            "domain": get_domain(addr),
            "sent_to": sent,
            "received_from": received,
            "total": total_exchange,
            "bidirectional": sent > 0 and received > 0,
            "first_contact": contact_first_seen.get(addr, datetime.min).strftime("%Y-%m-%d") if addr in contact_first_seen else "?",
            "last_contact": contact_last_seen.get(addr, datetime.min).strftime("%Y-%m-%d") if addr in contact_last_seen else "?",
        })

    contacts.sort(key=lambda c: c["total"], reverse=True)

    # Group contacts by domain for work/org detection
    domain_contacts = defaultdict(list)
    for c in contacts:
        if c["domain"] not in ("gmail.com", "yahoo.com", "hotmail.com", "aol.com", "outlook.com", "icloud.com"):
            domain_contacts[c["domain"]].append(c)

    # Top services
    top_services = [
        {"domain": domain, "emails": count}
        for domain, count in service_domains.most_common(30)
        if count >= 10
    ]

    # Attach subjects and yearly activity to each contact
    for c in contacts:
        addr = c["email"]
        c["subjects"] = contact_subjects.get(addr, [])[:15]
        c["years_active"] = dict(sorted(contact_years.get(addr, {}).items()))

    return {
        "total_messages": total,
        "processed": processed,
        "spam_filtered": spam_filtered,
        "contacts": contacts[:100],
        "domain_contacts": {
            domain: [c["email"] for c in cs]
            for domain, cs in sorted(domain_contacts.items(), key=lambda x: len(x[1]), reverse=True)[:20]
        },
        "top_services": top_services,
        "messages_by_year_month": dict(sorted(messages_by_year_month.items())),
        "sent_by_year": dict(sorted(sent_by_year.items())),
        "received_by_year": dict(sorted(received_by_year.items())),
        "sent_subjects_by_year": {
            y: subjects[:30] for y, subjects in sorted(sent_subjects_by_year.items())
        },
    }


def build_thoughts(analysis: dict) -> list[dict]:
    """Convert analysis into thoughts ready for capture."""
    thoughts = []

    contacts = analysis.get("contacts", [])
    bidirectional = [c for c in contacts if c["bidirectional"]]

    # 1. Overall email profile
    thoughts.append({
        "text": (
            f"Gmail profile: {analysis['total_messages']} total emails, "
            f"{analysis['processed']} non-spam processed.\n"
            f"Active contacts (3+ emails exchanged): {len(contacts)}\n"
            f"Bidirectional contacts (both sent and received): {len(bidirectional)}"
        ),
        "category": "email_profile",
    })

    # 2. Individual contact profiles (top 50 bidirectional contacts)
    for c in bidirectional[:50]:
        parts = [
            f"Email contact: {c['email']}",
            f"  Total: {c['total']} emails (sent {c['sent_to']}, received {c['received_from']})",
            f"  Active: {c['first_contact']} to {c['last_contact']}",
        ]
        if c.get("years_active"):
            active_years = [f"{y}:{n}" for y, n in c["years_active"].items() if n > 0]
            parts.append(f"  Activity by year: {', '.join(active_years)}")
        if c.get("subjects"):
            parts.append(f"  Sample subjects: {'; '.join(c['subjects'][:8])}")
        thoughts.append({
            "text": "\n".join(parts),
            "category": "contact_profile",
        })

    # 3. Work/organization contacts grouped by domain
    domain_contacts = analysis.get("domain_contacts", {})
    for domain, emails in list(domain_contacts.items())[:15]:
        if len(emails) < 2:
            continue
        # Find the contacts in this domain
        domain_people = [c for c in contacts if c["domain"] == domain]
        lines = [f"Organization contacts: {domain} ({len(emails)} people)"]
        for dp in domain_people[:10]:
            lines.append(
                f"  {dp['email']}: {dp['total']} emails, "
                f"{dp['first_contact']} to {dp['last_contact']}"
            )
        if len(domain_people) > 10:
            lines.append(f"  ... +{len(domain_people)-10} more")
        thoughts.append({
            "text": "\n".join(lines),
            "category": "org_contacts",
        })

    # 4. Services and subscriptions (grouped into chunks)
    services = analysis.get("top_services", [])
    if services:
        for i in range(0, len(services), 10):
            chunk = services[i:i + 10]
            lines = [f"  {s['domain']}: {s['emails']} emails" for s in chunk]
            thoughts.append({
                "text": f"Services and subscriptions (#{i+1}-{i+len(chunk)} by volume):\n" + "\n".join(lines),
                "category": "services",
            })

    # 5. Email volume timeline (sent + received by year)
    sent_yearly = analysis.get("sent_by_year", {})
    recv_yearly = analysis.get("received_by_year", {})
    all_years = sorted(set(sent_yearly.keys()) | set(recv_yearly.keys()))
    if all_years:
        lines = []
        for y in all_years:
            s = sent_yearly.get(y, 0)
            r = recv_yearly.get(y, 0)
            lines.append(f"  {y}: {s} sent, {r} received ({s+r} total)")
        thoughts.append({
            "text": "Email volume by year:\n" + "\n".join(lines),
            "category": "email_timeline",
        })

    # 6. Sent email topics by era
    subjects_by_year = analysis.get("sent_subjects_by_year", {})
    eras = [
        ("2000-2007", [str(y) for y in range(2000, 2008)]),
        ("2008-2013", [str(y) for y in range(2008, 2014)]),
        ("2014-2019", [str(y) for y in range(2014, 2020)]),
        ("2020-2026", [str(y) for y in range(2020, 2027)]),
    ]
    for era_name, years in eras:
        era_subjects = []
        for y in years:
            for s in subjects_by_year.get(y, []):
                era_subjects.append(s)
        if not era_subjects:
            continue
        # Deduplicate and sample
        seen = set()
        unique = []
        for s in era_subjects:
            normalized = s.lower().strip()
            if normalized not in seen:
                seen.add(normalized)
                unique.append(s)
        sample = unique[:20]
        thoughts.append({
            "text": f"Sent email topics ({era_name}, {len(unique)} unique subjects):\n  " + "\n  ".join(sample),
            "category": "email_topics",
        })

    return thoughts


def _post_json(host: str, path: str, body: bytes, headers: dict) -> dict:
    """Make an HTTPS POST request and return parsed JSON."""
    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection(host, timeout=60, context=ctx)  # nosemgrep: httpsconnection-detected
    try:
        conn.request("POST", path, body=body, headers=headers)
        resp = conn.getresponse()
        return json.loads(resp.read().decode("utf-8"))
    finally:
        conn.close()


def capture_to_brain(thoughts: list[dict], api_url: str, api_key: str) -> None:
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

    for i, thought in enumerate(thoughts):
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": i + 1,
            "method": "tools/call",
            "params": {
                "name": "capture_thought",
                "arguments": {"text": thought["text"]},
            },
        }).encode("utf-8")

        try:
            result = _post_json(host, path, payload, headers)
            if "error" in result:
                print(f"  [{i+1}/{len(thoughts)}] Error: {result['error']['message']}", flush=True)
                errors += 1
            else:
                content = result.get("result", {}).get("content", [{}])
                text = content[0].get("text", "") if content else ""
                print(f"  [{i+1}/{len(thoughts)}] {text}", flush=True)
                captured += 1
        except Exception as e:
            print(f"  [{i+1}/{len(thoughts)}] Failed: {e}", flush=True)
            errors += 1

    print(f"\nDone: {captured} captured, {errors} errors", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Parse Gmail mbox export and migrate to Open Brain"
    )
    parser.add_argument(
        "input_file",
        help="Path to .mbox file (parse mode) or gmail-export.json (capture mode)",
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
        default="gmail-export.json",
        help="Output JSON file (default: gmail-export.json)",
    )
    parser.add_argument(
        "--email",
        default="ryan.niemes@gmail.com",
        help="Your Gmail address (to distinguish sent vs received)",
    )
    args = parser.parse_args()

    input_path = Path(args.input_file)
    if not input_path.exists():
        print(f"Error: {input_path} not found")
        sys.exit(1)

    # Capture mode
    if args.capture:
        import os

        api_url = args.api_url or os.environ.get("API_URL")
        api_key = args.api_key or os.environ.get("API_KEY")

        if not api_url or not api_key:
            print("Error: --capture requires API_URL and API_KEY")
            print("  Set via env vars or --api-url / --api-key flags")
            print("  Create an API key with: brain create-agent migration")
            sys.exit(1)

        thoughts = json.loads(input_path.read_text())
        print(f"Capturing {len(thoughts)} thoughts to brain...", flush=True)
        capture_to_brain(thoughts, api_url, api_key)
        return

    # Parse mode
    if not str(input_path).endswith(".mbox"):
        print(f"Error: expected .mbox file, got {input_path}")
        print("If this is a reviewed JSON, use --capture flag")
        sys.exit(1)

    print(f"Analyzing {input_path} ({input_path.stat().st_size / 1_073_741_824:.1f} GB)...", flush=True)

    analysis = analyze_mbox(str(input_path), args.email)

    print(f"\nResults:", flush=True)
    print(f"  Total messages: {analysis['total_messages']}", flush=True)
    print(f"  Non-spam processed: {analysis['processed']}", flush=True)
    print(f"  Spam filtered: {analysis['spam_filtered']}", flush=True)
    print(f"  Contacts found: {len(analysis['contacts'])}", flush=True)

    thoughts = build_thoughts(analysis)
    print(f"\nGenerated {len(thoughts)} thoughts:", flush=True)
    for t in thoughts:
        preview = t["text"][:80].replace("\n", " ")
        print(f"  [{t['category']}] {preview}...", flush=True)

    output_path = Path(args.output)
    output_path.write_text(json.dumps(thoughts, indent=2, ensure_ascii=False))
    print(f"\nSaved to {output_path}", flush=True)
    print(f"\nNext steps:", flush=True)
    print(f"  1. Review {output_path} — edit or remove entries you don't want", flush=True)
    print(f"  2. Run: python3 {sys.argv[0]} {output_path} --capture --api-url <URL> --api-key <KEY>", flush=True)


if __name__ == "__main__":
    main()
