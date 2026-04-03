# Changelog

## [Unreleased]

### Added
- **AWS Enterprise path** — fully serverless deployment using S3 Vectors, Lambda, API Gateway, Cognito, and Bedrock
- `cdk/lib/stacks/vector-storage-stack.ts` — S3 vector bucket with shared index via CloudFormation L1 constructs
- `lambda/src/services/vectors.ts` — S3 Vectors client wrapper with on-demand private index creation
- Private/shared scoping model: `private-{userId}` indexes for personal thoughts, `shared` index for org-wide access
- Graceful handling when querying indexes that don't exist yet (returns empty results instead of errors)
- Enterprise setup section in README
- **Google Meet ingestion** — Apps Script add-on that auto-captures Gemini meeting summaries as shared thoughts (AWS Enterprise path). Includes PII/PHI scrubbing (regex, keyword blocklist, full-meeting skip by title label). See `google-meet/`.
- Design doc: `docs/plans/2026-03-08-google-meet-ingestion-design.md`
- CHANGELOG.md

### Changed
- **Breaking:** Enterprise path tool schemas now use `scope` (private/shared/all) instead of `visibility` (private/team/public) and `team_id`
- `cdk/bin/enterprise-brain.ts` — replaced DatabaseStack with VectorStorageStack
- `cdk/lib/stacks/api-stack.ts` — removed RDS/Secrets Manager props, added S3 Vectors IAM permissions
- All Lambda handlers rewritten to use S3 Vectors API instead of RDS Data API
- `lambda/src/types.ts` — updated types for new scope model, removed `ThoughtRow`
- `lambda/src/index.ts` — updated MCP tool schemas for scope parameters
- `lambda/package.json` — swapped `@aws-sdk/client-rds-data` for `@aws-sdk/client-s3vectors`
- README.md — updated architecture diagram, added both deployment paths, updated project structure
- CLAUDE.md — updated repo purpose and development notes for both paths

### Removed
- `cdk/lib/stacks/database-stack.ts` — Aurora PostgreSQL Serverless v2 + VPC (replaced by S3 Vectors)
- `lambda/src/services/database.ts` — RDS Data API client (replaced by vectors.ts)
