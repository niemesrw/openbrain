# Google Meet → Open Brain Ingestion

Automatically captures Gemini-generated meeting summaries into Open Brain (AWS Enterprise) as shared thoughts. PII/PHI is scrubbed before data leaves Google Workspace.

## How It Works

1. After a Google Meet, Gemini creates a summary doc and emails you a link
2. A Gmail filter applies a label to those emails
3. An Apps Script runs every 5 minutes, finds labeled emails, reads the linked Google Doc
4. The summary is extracted (transcript section is excluded), PII/PHI is scrubbed
5. The cleaned summary is captured to Open Brain as a shared thought
6. The label is removed and the doc ID is recorded to prevent duplicates

## Prerequisites

- Open Brain AWS Enterprise stack deployed (Cognito + API Gateway + Lambda)
- A Cognito user account for the ingestion script (service account)
- Google Workspace account with Gmail and Google Drive access

## Setup

### 1. Create a Cognito Service Account

Create a user in your Cognito user pool for the ingestion script:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username meet-ingestion \
  --temporary-password TempPass123! \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id YOUR_USER_POOL_ID \
  --username meet-ingestion \
  --password YOUR_PERMANENT_PASSWORD \
  --permanent
```

### 2. Create the Gmail Label and Filter

1. In Gmail, create a new label: `open-brain/to-ingest`
2. Create a filter:
   - **From:** check a recent Gemini meeting notes email for the exact sender (commonly `workspace-noreply@google.com` or `meetings-noreply@google.com`)
   - **Subject:** optionally include "meeting notes" or similar
   - **Action:** Apply label `open-brain/to-ingest`

> **Tip:** Open a recent meeting notes email, click the three dots menu → "Filter messages like these" to pre-fill the filter.

### 3. Create the Apps Script Project

1. Go to [script.google.com](https://script.google.com) → **New project**
2. Name it "Open Brain Meet Ingestion"
3. Delete the default `Code.gs` content
4. Create four files and paste the contents from this directory:
   - `Code.gs`
   - `Auth.gs`
   - `Scrubber.gs`
5. Replace the contents of `appsscript.json`:
   - Click the gear icon (Project Settings) → check "Show appsscript.json manifest file"
   - Click `appsscript.json` in the editor and replace with the version from this directory

### 4. Set Script Properties

In the Apps Script editor: **Project Settings** (gear icon) → **Script Properties** → **Add**:

| Property | Value |
|---|---|
| `COGNITO_USER_POOL_ID` | Your Cognito user pool ID (e.g., `us-east-1_abc123`) |
| `COGNITO_CLIENT_ID` | The CLI client ID from your auth stack |
| `COGNITO_USERNAME` | `meet-ingestion` (or whatever you used above) |
| `COGNITO_PASSWORD` | The permanent password you set |
| `MCP_URL` | Your API Gateway endpoint (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com/mcp`) |
| `GMAIL_LABEL` | `open-brain/to-ingest` |
| `ENABLED` | `true` |

**Optional properties:**

| Property | Value |
|---|---|
| `SKIP_LABELS` | Comma-separated labels that skip ingestion (e.g., `PHI,CONFIDENTIAL,NO-RECORD`) |
| `PII_BLOCKLIST` | Extra terms to redact (e.g., `patient,diagnosis,medication`) |

> **Security note:** Script Properties are not encrypted. Any editor of this Apps Script project can view the stored Cognito credentials. Restrict editor access to trusted users only. For higher-security environments, consider using Google Cloud Secret Manager via the Apps Script Advanced Service.

### 5. Create the Trigger

1. In the Apps Script editor: **Triggers** (clock icon in sidebar) → **Add Trigger**
2. Function: `processNewMeetings`
3. Event source: **Time-driven**
4. Type: **Minutes timer** → **Every 5 minutes**
5. Click **Save**
6. Authorize the requested permissions when prompted

### 6. Test

1. Find a recent meeting notes email (or send yourself a test)
2. Manually apply the `open-brain/to-ingest` label to it
3. In the Apps Script editor, click **Run** → `processNewMeetings`
4. Check **Execution log** for output
5. Verify the thought was captured: use any MCP client to search for the meeting topic

## PII/PHI Protection

Three layers of protection, all running before data leaves Google:

1. **Regex scrubbing** — automatically redacts SSNs, phone numbers, email addresses, credit card numbers, dates of birth, and medical record numbers
2. **Keyword blocklist** — sentences containing terms like "diagnosis", "prescription", "patient" are replaced with `[REDACTED]`. Add your own terms via the `PII_BLOCKLIST` property.
3. **Full-meeting skip** — meetings with `[PHI]`, `[CONFIDENTIAL]`, or `[NO-RECORD]` in the title are skipped entirely. Configure via `SKIP_LABELS`.

## Troubleshooting

**"Label not found"** — Create the label in Gmail first. Nested labels use `/` syntax (e.g., `open-brain/to-ingest`).

**"No Google Doc link found"** — The email body didn't contain a `docs.google.com/document/d/` link. Check the email format — Gemini may use a different link format in your Workspace configuration.

**"Could not read doc"** — The Apps Script doesn't have permission to read the doc. Make sure the doc is accessible to the Google account running the script.

**"Cognito auth failed"** — Check your user pool ID, client ID, username, and password in Script Properties. Ensure the user exists and the password is permanent (not temporary).

**"MCP capture failed"** — Check the MCP URL is correct and the API Gateway is deployed. Look at CloudWatch Logs for Lambda errors.

**Duplicate captures** — Should not happen due to doc ID tracking. If it does, check the `PROCESSED_DOC_IDS` Script Property — it should be a JSON array of doc IDs.
