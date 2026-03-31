# Open Brain — Threat Model

**Date:** 2026-03-31  
**Scope:** Lambda MCP server, web dashboard, GitHub/Slack/Google integrations, agent bus  
**Methodology:** Manual source code review + data flow analysis

---

## System Overview

Open Brain is a personal knowledge base running on AWS Lambda/API Gateway, storing vector embeddings in S3 Vectors, with Cognito-backed authentication (Google OAuth + Apple), a GitHub App integration (webhooks → SQS → Lambda), a Slack integration, and a shared "agent bus" where multiple agents read and write thoughts.

### Trust Boundaries

| Boundary | Enforcement |
|----------|-------------|
| Web/CLI → API | Cognito JWT (verified via `aws-jwt-verify`) |
| Agent → API | API key (`ob_` prefix, DynamoDB lookup) |
| GitHub → API | HMAC-SHA256 webhook signature (`timingSafeEqual`) |
| Slack → API | HMAC-SHA256 + 5-minute timestamp window |
| Lambda → AWS services | IAM execution role (least-privilege per stack) |
| OAuth clients → API | DCR-issued Cognito clients + redirect URI allowlist |

### Entry Points

| Route | Auth | Notes |
|-------|------|-------|
| `POST /mcp` | In-Lambda JWT or API key | MCP protocol handler |
| `POST /chat`, `POST /brain/chat` | API GW authorizer | Streaming chat API routes |
| Streaming Function URL (chat) | In-Lambda only (`authType: NONE`) | Outside API GW rate limiting/WAF |
| `GET /insight` | In-Lambda JWT or API key | |
| `POST /github/webhook` | HMAC-SHA256 signature | No replay protection |
| `POST /webhooks/slack` | HMAC-SHA256 + timestamp | |
| `GET /auth/config`, `/.well-known/*` | None | Public metadata |
| `POST /register` | None (rate-limited: 10/IP/hr) | OAuth DCR |
| `/oauth/authorize`, `/oauth/token` | None | OAuth proxy to Cognito |
| `/github/*`, `/slack/*`, `/google/*`, `/user` | In-Lambda JWT | |

---

## Findings

### CRITICAL

#### C1 — Shared Index Multi-Tenant Data Leakage

**Component:** `lambda/src/handlers/browse-recent.ts`, `search-thoughts.ts`, `bus-activity.ts`  
**Issue:** The shared S3 Vectors index is a single global namespace. Tenant isolation is enforced by filtering metadata client-side after a full index scan — there is no server-side partition. Any authenticated user or agent can read all shared thoughts from all other users by omitting the `tenant_id` parameter. The `bus_activity` tool exposes a real-time feed of all shared activity across all tenants.

```typescript
// browse-recent.ts — tenant_id filter is optional and client-side only
if (tenant_id) {
  all = all.filter((v) =>
    v._indexName === `private-${user.userId}` ||
    !v.metadata.tenant_id ||
    v.metadata.tenant_id === tenant_id
  );
}
```

**Impact:** Cross-tenant information disclosure of all shared thought content, topics, people mentioned, and activity patterns.

**Remediation:** Enforce `tenant_id` as a required metadata filter on all shared index reads. Pass `tenant_id: user.userId` server-side in every S3 Vectors query against the shared index, regardless of what the caller requests. See GitHub issue for scoped implementation plan.

---

### HIGH

#### H1 — GitHub Webhook Replay Attacks

**Component:** `lambda/src/github-webhook.ts`  
**Issue:** Webhook signature verification uses HMAC-SHA256 but has no timestamp or delivery-ID validation. A captured request with a valid signature can be replayed indefinitely. GitHub sends a unique `X-GitHub-Delivery` UUID per event.

**Impact:** Replay of old PR, push, or release events — reprocessing merged PRs, capturing stale commits, potentially triggering duplicate SQS messages that enqueue agent work.

**Remediation:** Store processed `X-GitHub-Delivery` UUIDs in DynamoDB with a short TTL (e.g. 24h) and reject duplicates. Optionally add `X-GitHub-Event-Timestamp` validation for defense-in-depth.

#### H2 — Streaming Chat Function URL Outside API Gateway Auth Boundary

**Component:** `cdk/lib/stacks/api-stack.ts` (line ~194), `lambda/src/chat.ts` (Function URL handler), `lambda/src/handlers/brain-chat.ts` (`/brain/chat` API route)  
**Issue:** The streaming chat Lambda is exposed via a Function URL with `authType: NONE`. `chat.ts` wraps `verifyAuth()` in a try/catch that returns 401 on failure, so auth bypass via uncaught exceptions is not the risk. The risk is that the Function URL sits entirely outside the API Gateway boundary — it bypasses API Gateway rate limiting, WAF rules, and centralised request logging.

**Impact:** Publicly reachable streaming endpoint that depends solely on in-Lambda auth; excluded from API Gateway throttling, WAF protections, and some observability. Any future regression in `verifyAuth()` has no gateway-level safety net.

**Remediation:** Move the streaming endpoint behind API Gateway with the existing Lambda authorizer, or enable IAM-based Function URL auth. At minimum, ensure CloudWatch alarms cover the Function URL invocation metrics separately from the API Gateway metrics.

---

### MEDIUM

#### M1 — API Keys Stored in Plaintext

**Component:** `lambda/src/handlers/agent-keys.ts`, DynamoDB `openbrain-agent-keys`  
**Issue:** Agent API keys (`ob_{32-byte-hex}`) are stored as plaintext in DynamoDB. A table compromise immediately exposes all active keys with no revocation signal.

**Impact:** Full agent impersonation if the DynamoDB table is exfiltrated.

**Remediation:** Store a keyed HMAC (HMAC-SHA256 with a KMS-managed key) of the API key rather than the plaintext. On verification, compute the HMAC of the presented key and compare. Rotate existing keys.

#### M2 — Agent-to-Agent Escalation Within Shared User Context

**Component:** `lambda/src/handlers/agent-keys.ts`  
**Issue:** All agents under the same user share identical permissions. Any agent can call `revoke_agent` or `create_agent` for any other agent owned by the same user. There is no per-agent RBAC or self-only enforcement.

**Impact:** A compromised or malicious agent can revoke other agents or create new agents, affecting availability and integrity of the agent fleet.

**Remediation:** Restrict `revoke_agent` so agents can only revoke their own key. Restrict `create_agent` to human (JWT) callers only, not API key callers.

#### M3 — OAuth Loopback Redirect URI Cognito Update Conflicts

**Component:** `lambda/src/oauth.ts` (`ensureLoopbackRedirectUri`)  
**Issue:** Each authorization attempt with a new ephemeral loopback port calls `UpdateUserPoolClient` to add the current port and prune stale loopback entries. This prune-then-add cycle is not atomic: concurrent requests can read the same current list, each add their own port, and the last writer wins — dropping the other's entry. There is also no upper bound on how many loopback URIs can accumulate if the prune logic fails or is bypassed.

**Impact:** Race condition under concurrent auth flows can cause one client's loopback redirect to be silently dropped, resulting in an OAuth failure for that session. Repeated failures could indicate exploitation.

**Remediation:** Enforce a hard cap (e.g. 10 loopback URIs per client) and reject rather than silently drop when the cap is reached. For the race condition, serialize loopback URI updates (e.g. via a DynamoDB conditional write lock) or accept at-most-once semantics with client retry.

#### M4 — Slack OAuth Tokens Have No Refresh Logic

**Component:** `lambda/src/handlers/slack-connect.ts`  
**Issue:** Slack access tokens are stored in DynamoDB with no refresh logic. When a Slack token expires or is revoked, the integration silently fails with no recovery path short of manual re-authentication. The Google integration (`google-connect.ts`) does implement refresh-on-expiry, but does not rotate the refresh token on use — a compromised refresh token remains valid indefinitely.

**Impact:** Silent Slack integration failures when tokens expire. For Google, a stolen refresh token is not invalidated after use, extending the exposure window.

**Remediation:** For Slack: implement refresh-on-expiry using the stored refresh token before each API call. For Google: rotate the refresh token on each use (replace stored token with the new one returned by the token endpoint) to limit the usability of a leaked token.

---

### LOW

#### L1 — Source Attribution Is Trust-Based, Not Cryptographically Verified

**Component:** `lambda/src/handlers/capture-thought.ts`  
**Issue:** The `source` field (e.g. `"github"`) is set based on an allowlist check on a parameter passed by the calling agent. There is no cryptographic proof that a thought originated from the GitHub agent vs. any other caller who passes `_source: "github"`. The allowlist check prevents arbitrary values but not spoofing by an agent key holder.

**Impact:** An agent with a valid API key can label its captures as `source: "github"` to appear as GitHub-sourced activity.

**Remediation:** Derive `source` from the caller's identity server-side (e.g. from `user.agentName`) rather than accepting it as a parameter. The `_source` parameter should be removed; the Lambda handler should infer it from the authenticated agent context.

#### L2 — Unbounded Chat Messages Array Before Bedrock Invocation

**Component:** `lambda/src/chat.ts`, `lambda/src/handlers/search-thoughts.ts`  
**Issue:** `chat.ts` accepts an arbitrary `messages` array from the caller and passes it directly to `streamText` without validating array length or individual message size. A caller can send thousands of messages or a single extremely large message, driving up Bedrock token consumption and Lambda execution time. Similarly, `search-thoughts.ts` passes the query string to `generateEmbedding` without a length cap — an oversized query will be silently truncated or rejected by Bedrock with a generic error.

**Impact:** Unnecessary Bedrock cost and confusing error responses on large inputs; theoretical resource exhaustion against the streaming Lambda.

**Remediation:** Add a `MAX_MESSAGES` cap (e.g. 50 items) and a `MAX_MESSAGE_LENGTH` check in `chat.ts` before the `streamText` call. Add a `MAX_QUERY_LENGTH` (e.g. 2000 chars) check in `search-thoughts.ts` before calling `generateEmbedding`.

---

## Summary

| ID | Severity | Title |
|----|----------|-------|
| C1 | Critical | Shared index multi-tenant data leakage |
| H1 | High | GitHub webhook replay attacks |
| H2 | High | Chat Function URL has no API Gateway auth |
| M1 | Medium | API keys stored in plaintext |
| M2 | Medium | Agent-to-agent escalation within shared user context |
| M3 | Medium | OAuth loopback redirect URI Cognito update race condition |
| M4 | Medium | Slack OAuth tokens have no refresh; Google refresh tokens not rotated |
| L1 | Low | Source attribution is trust-based |
| L2 | Low | Unbounded query parameters before Bedrock invocation |

---

## What Is Out of Scope / Accepted Risk

- **Single-tenant deployment:** Open Brain is designed as a personal/small-team tool. The shared index leakage (C1) is most impactful in a multi-user hosted scenario; self-hosted single-user deployments have lower exposure.
- **DynamoDB at-rest encryption:** AWS encrypts DynamoDB at rest by default; the plaintext API key risk (M1) is about exfiltration of table data, not physical storage.
- **Cognito as identity provider:** Cognito security (session management, MFA, brute force) is delegated to AWS and out of scope here.
