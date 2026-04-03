# Google Meet Transcript Ingestion

## Overview

Automatically ingest Gemini-generated meeting summaries from Google Meet into Open Brain (AWS Enterprise path) as shared thoughts. Includes PII/PHI scrubbing before data leaves Google Workspace.

## Flow

```
Google Meet → Gemini Notes (Google Doc) → Email notification
                                              ↓
                                     Gmail filter applies label
                                     (e.g. "open-brain/to-ingest")
                                              ↓
                                     Google Apps Script
                                     (triggered by label)
                                              ↓
                                     1. Extract Google Doc link from email
                                     2. Open doc, extract summary section
                                     3. PII/PHI scrubbing
                                     4. POST to MCP capture_thought (scope: shared)
                                     5. Remove label + record doc ID (dedup)
```

## What Gets Captured

Gemini's summary notes only — not the raw transcript. One thought per meeting. The summary contains decisions, action items, and key points, which is what users search for later. The full transcript stays in Google Docs as the source of record.

## PII/PHI Scrubbing

Three layers, all running in the Apps Script before data leaves Google Workspace:

### 1. Regex Patterns

Strip obvious PII:
- SSNs (XXX-XX-XXXX)
- Phone numbers
- Email addresses
- Credit card numbers
- Date of birth patterns
- Medical record numbers

Redacted text is replaced with `[REDACTED]`.

### 2. Keyword Blocklist

Configurable list of terms. If any appear in the summary, the matching sentences are redacted. Defaults:
- `diagnosis`, `prescription`, `SSN`, `social security`, `date of birth`, `medical record`, `patient`, `HIPAA`

Users add domain-specific terms via Script Properties.

### 3. Full-Meeting Skip

If the meeting title contains certain labels, skip ingestion entirely:
- `[PHI]`, `[CONFIDENTIAL]`, `[NO-RECORD]`

Configurable via Script Properties. Skipped meetings are logged but not sent.

## Backend

AWS Enterprise path only. The Apps Script authenticates via Cognito JWT (user/password auth flow against the CLI client) and calls the MCP endpoint.

### Auth Flow in Apps Script

1. Script stores Cognito credentials in Script Properties
2. On trigger, calls Cognito `InitiateAuth` (USER_PASSWORD_AUTH) to get a JWT
3. Uses the JWT as `Authorization: Bearer <token>` on MCP calls
4. Caches the token in Script Properties until expiry (1 hour for CLI client)

> **Security note:** Script Properties are not encrypted. Any editor of the Apps Script project can view stored credentials. This is acceptable for single-user or small-team setups where script access is restricted. For higher-security environments, use Google Cloud Secret Manager via the Apps Script Advanced Service instead.

## Trigger Mechanism

Apps Script doesn't have a native "on new email" trigger. Instead, use a label-based approach:

1. **Gmail filter** — create a filter matching meeting note emails (sender + subject pattern), auto-apply a label like `open-brain/to-ingest`
2. **Apps Script trigger** — a time-driven trigger (every 5 minutes) checks for threads with that label
3. **After processing** — remove the label from the thread and record the Google Doc ID in Script Properties to prevent duplicate ingestion

This is more reliable than polling by sender and naturally prevents re-processing.

### Gmail Filter Setup

The exact sender for Gemini meeting notes may vary by Workspace configuration. Common senders:
- `workspace-noreply@google.com`
- `meetings-noreply@google.com`
- `calendar-notification@google.com`

The README will instruct users to identify the correct sender from a recent meeting email and create the filter accordingly. Alternatively, filter by subject pattern (e.g., contains "meeting notes").

## Deduplication

To prevent capturing the same meeting twice (script retries, label reapplied, etc.):

1. Extract the Google Doc ID from the email link
2. Check against a stored set of processed doc IDs (kept in Script Properties as a JSON array)
3. If already processed, skip and remove the label
4. Cap the processed IDs list at 500 entries (FIFO) to avoid unbounded growth

## Configuration (Script Properties)

| Property | Description | Example |
|---|---|---|
| `COGNITO_USER_POOL_ID` | Cognito user pool ID | `us-east-1_abc123` |
| `COGNITO_CLIENT_ID` | CLI client ID | `abc123def456` |
| `COGNITO_USERNAME` | Service account username | `meet-ingestion@company.com` |
| `COGNITO_PASSWORD` | Service account password | `...` |
| `MCP_URL` | MCP endpoint URL | `https://abc123.execute-api.us-east-1.amazonaws.com/mcp` |
| `GMAIL_LABEL` | Label to watch for | `open-brain/to-ingest` |
| `SKIP_LABELS` | Meeting title labels that skip ingestion | `PHI,CONFIDENTIAL,NO-RECORD` |
| `PII_BLOCKLIST` | Extra terms to redact (comma-separated) | `patient,diagnosis` |
| `ENABLED` | On/off switch | `true` |

## File Structure

```
google-meet/
├── Code.gs              # Main: label trigger, doc fetch, MCP capture call
├── Scrubber.gs          # PII/PHI regex + blocklist redaction
├── Auth.gs              # Cognito JWT auth + token caching
├── README.md            # Setup guide
└── appsscript.json      # Manifest (scopes: Gmail, Drive, UrlFetch)
```

## Required Google Scopes

- `https://www.googleapis.com/auth/gmail.modify` — read emails, manage labels
- `https://www.googleapis.com/auth/drive.readonly` — open Google Docs by ID
- `https://www.googleapis.com/auth/script.external_request` — call MCP endpoint + Cognito

## Implementation Steps

### Step 1: Auth.gs — Cognito authentication

- `getAccessToken()` — calls Cognito `InitiateAuth` via `UrlFetchApp`, caches token + expiry in Script Properties
- Uses `USER_PASSWORD_AUTH` flow against the CLI Cognito client
- Returns cached token if not expired, otherwise refreshes

### Step 2: Scrubber.gs — PII/PHI redaction

- `scrubPii(text)` — runs regex patterns, replaces matches with `[REDACTED]`
- `scrubBlocklist(text, blocklist)` — removes sentences containing blocklisted terms
- `shouldSkip(meetingTitle, skipLabels)` — returns true if title contains a skip label

### Step 3: Code.gs — Main logic

- `processNewMeetings()` — time-driven trigger handler (every 5 min):
  1. Check `ENABLED` flag
  2. Find threads with `GMAIL_LABEL`
  3. For each thread:
     a. Extract Google Doc link from email body
     b. Check dedup — skip if doc ID already processed
     c. Open doc via `DriveApp.getFileById()` → read content
     d. Extract summary section (text before "Transcript" heading)
     e. Extract meeting title from doc title or email subject
     f. Check `shouldSkip()` on meeting title
     g. Run `scrubPii()` + `scrubBlocklist()`
     h. Get JWT via `getAccessToken()`
     i. POST to MCP endpoint: `tools/call` with `capture_thought`, `scope: "shared"`, text prefixed with meeting title + date
     j. Record doc ID in processed list
     k. Remove label from thread
     l. Log result

### Step 4: appsscript.json — Manifest

- Declare required OAuth scopes
- Set timezone

### Step 5: README.md — Setup guide

1. Create a Cognito service account user for the ingestion script
2. Create a Google Apps Script project (script.google.com)
3. Copy the `.gs` files and `appsscript.json`
4. Set Script Properties with Cognito credentials, MCP URL, label name
5. Create a Gmail filter: match meeting note emails → apply `open-brain/to-ingest` label
6. Create a time-driven trigger: `processNewMeetings`, every 5 minutes
7. Authorize scopes when prompted
8. Test: send yourself a test email with a Google Doc link, apply the label manually, run `processNewMeetings`

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `DocumentApp.openByUrl()` may not work for Gemini notes | Use `DriveApp.getFileById()` to read the doc; fall back to Docs REST API via `UrlFetchApp` if needed |
| Meeting note email sender varies by Workspace config | README instructs users to check their actual sender; filter by subject as fallback |
| Script Properties not encrypted | Document the risk; recommend restricting script editor access |
| Apps Script 6-minute execution limit | Process one thread at a time; if near limit, stop and let next trigger pick up remaining |

## Decisions

- **Summary only, not transcript** — lower noise, cheaper embedding, Gemini already did the summarization work
- **Regex scrubbing over LLM** — deterministic, no cost, no latency, runs before data leaves Google
- **Skip-by-label over scrub-and-ingest for sensitive meetings** — partial redaction isn't sufficient for PHI; full skip is safer
- **Cognito auth over API key** — AWS Enterprise path uses JWT auth; consistent with the existing auth model
- **Shared scope by default** — meeting notes are team context, not personal
- **Label-based trigger over "on new email"** — Apps Script doesn't have a real email trigger; label + time-driven is the standard pattern
- **Dedup via doc ID tracking** — prevents duplicate capture from retries or reapplied labels
- **DriveApp over DocumentApp** — more reliable for opening docs by ID; DocumentApp.openByUrl() has known quirks with non-standard doc types
