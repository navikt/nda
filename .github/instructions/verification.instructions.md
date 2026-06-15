---
applyTo: "app/lib/verification/**,app/lib/sync/github-verify.server.ts"
---

# Four-Eyes Verification

Full documentation: `docs/verification.md`

## Key Files

- `verify.ts` — Pure `verifyDeployment()` with 9 decision steps (0a: repo, 0b: branch, 1–7)
- `index.ts` — `runVerification()` orchestration (fetch → verify → store)
- `types.ts` — `VerificationStatus`, `UnverifiedReason`, `ImplicitApprovalMode`
- `fetch-data.server.ts` — GitHub data fetching; always fetch `branch_name` from GitHub at verification time — never use cached DB values like `default_branch`

## Rules

**Always ask the user for confirmation before modifying the verification algorithm.** Present the proposed change and wait for explicit approval. This system is critical for audit compliance.

**Always update `docs/verification.md`** when modifying `verify.ts`.

When modifying verification logic, add or update tests:
- `verify.ts` changes → unit tests in `app/lib/__tests__/`
- `fetch-data.server.ts` changes → integration tests in `app/db/__tests__/integration/`
- New statuses/reasons → test cases covering all new paths

## Status Categorization — Single Source of Truth

All status categorization **must** use helpers from `app/lib/four-eyes-status.ts`. Never define inline status lists.

- TypeScript helpers: `isApprovedStatus()`, `isPendingStatus()`, `isNotApprovedStatus()`, `isLegacyStatus()`, `isProtectedStatus()`
- SQL constants: `APPROVED_STATUSES_SQL`, `PENDING_STATUSES_SQL`

Exception: checking a *specific* status for display purposes (e.g., `=== 'manually_approved'`) is fine. The rule applies to *category* checks.

## Archived Reports

Archived reports must never appear in public-facing views or M2M APIs:
- `getAuditReportsForApp()` — excludes archived (public)
- `getAuditReportsForAppAdmin()` — includes archived (admin only)
- All new listing endpoints must filter `archived_at IS NULL` unless explicitly admin-only
