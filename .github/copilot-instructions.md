# Copilot Code Review Instructions

## PR Checklist

When reviewing PRs in this repo, check for the following:

### Tests
- New Lambda handlers (`lambda/src/handlers/*.ts`) must have a corresponding test file in `lambda/src/handlers/__tests__/`.
- Run `cd lambda && npm test` — all tests must pass before merging.

### Lambda Handler Conventions
- Route auth is handled in `lambda/src/index.ts` — every new route must call `verifyAuth()` and return 401 on failure.
- New routes must be added to both `lambda/src/index.ts` (handler dispatch) and `cdk/lib/stacks/api-stack.ts` (HTTP API route).
- Error logging must use `err instanceof Error ? err.message : String(err)` to handle non-Error throws.

### Performance
- `listAllVectors()` performs a full index scan. Flag any new usage on hot paths (e.g., routes called on every page load) without a caching or pagination strategy.

### Web (React SPA)
- When exploring (filter/search) from an insight or suggestion card, clear both `activeTopic` and `activeType` to avoid stale filter state.
- New fetch functions in `web/src/lib/api.ts` should include an `AbortSignal` parameter where applicable.
- `cd web && npm run build` must succeed for any `web/` changes.

### CDK
- New Lambda environment variables must be added to the Lambda function definition in `cdk/lib/stacks/api-stack.ts`.
- The web SPA is deployed via `web/dist` — the CDK synth will fail if the build output is missing.

### OAuth / Auth
- The `authorization_servers` field in `/.well-known/oauth-protected-resource` must contain the AS issuer base URL (e.g. `https://brain.example.com`), **not** the full metadata URL. Spec-compliant clients append `/.well-known/oauth-authorization-server` themselves.
