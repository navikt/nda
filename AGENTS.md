# Agent Instructions

## Before Committing

```bash
pnpm run check && pnpm test && pnpm run knip && pnpm run build && pnpm run build-storybook
```

All must pass. Zero lint warnings.

## Commit Message Format

```
type(scope?): subject
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

## Server/Client Boundary

Files ending in `.server.ts` are server-only — cannot be imported in client-side code. Shared constants must live in non-server files (e.g., `app/db/sync-job-types.ts`).

## Four-Eyes Verification

Full documentation: `docs/verification.md`
File-scoped rules: `.github/instructions/verification.instructions.md`

**Always ask the user for confirmation before modifying the verification algorithm.**

**Status categorization** — always use helpers from `app/lib/four-eyes-status.ts`. Never define inline status lists:
- TypeScript: `isApprovedStatus()`, `isPendingStatus()`, `isNotApprovedStatus()`, `isLegacyStatus()`, `isProtectedStatus()`
- SQL: `APPROVED_STATUSES_SQL`, `PENDING_STATUSES_SQL`

**Archived reports** — filter `archived_at IS NULL` in all public-facing views and M2M APIs.

## Authorization (RBAC)

File-scoped rules: `.github/instructions/authorization.instructions.md`

Key rules always in effect:
- Single-pass auth: `resolve*Capabilities()` — one DB round-trip for all capability checks
- Capability flags in loaders — do not render elements that return 403
- Data minimization — resolve capabilities before queries; skip queries when absent; strip internal metadata from client responses
- Mutation functions that may no-op return `boolean` — actions must check the return value
- Action errors: `fail()` / `return { error: '...' }` — never `throw new Response()` for user errors

## Module Structure

### GitHub API (`app/lib/github/`)
`client.server.ts`, `pr.server.ts`, `git.server.ts`, `legacy.server.ts`, `index.ts`

### Deployments DB (`app/db/deployments/`)
`stats.server.ts`, `notifications.server.ts`, `home.server.ts`, `status-history.server.ts`
All re-exported from `app/db/deployments.server.ts`.

### Slack (`app/lib/slack/`)
`client.server.ts`, `blocks.ts`, `block-kit-url.ts`, `index.ts`

### Sync (`app/lib/sync/`)
`scheduler.server.ts`, `log-cache.server.ts`, `log-cache-job.server.ts`, `goal-keyword-sync.server.ts`, `index.ts`

### Outgoing HTTP Logging
All HTTP calls must use `fetchWithLogging()` or `logOutgoingHttp()` from `app/lib/logger.server.ts`.
File-scoped rules: `.github/instructions/http-logging.instructions.md`

## Route Conventions

File-scoped rules: `.github/instructions/routes.instructions.md`

**Route Registration (CRITICAL)**: Routes are not auto-discovered. A file in `app/routes/` requires a `route()` entry in `app/routes.ts` or it 404s. Run `pnpm exec react-router typegen` after adding a route.

**Action extraction**: Large route files split actions into `*.actions.server.ts`:
```ts
export { action } from './$id.actions.server'
```

**Action results**: Use `ok()` / `fail()` from `app/lib/action-result.ts`. Render with `<ActionAlert data={actionData} />`.

**Route parameter validation**: `Number.isFinite()` after `parseInt()`, throw 400 for invalid values.

**Named `Promise.all`**: Always destructure by name — never positional index casting.

## Required UI Components

**`<ExternalLink href={...}>`** — required for ALL links to external domains (GitHub, NAIS Console, Slack, Teamkatalogen, etc.). Provides `target="_blank"`, `rel="noopener noreferrer"`, and an icon automatically.

**`<UserName username={x} userMappings={m} />`** — always use for deployer/reviewer display. Never show raw GitHub usernames in deployment/commit UI.

## Storybook & Component Extraction

File-scoped rules: `.github/instructions/storybook.instructions.md`

Routes are thin orchestrators. Non-trivial UI lives in `app/components/` — props-based, no `useLoaderData()`. Stories in `app/routes/__stories__/`.

## Test Data Conventions

- **Person names**: "Adjektiv Substantiv" (Norwegian) — e.g. "Glad Fjord", "Rask Elv"
- **NAV-idents**: Z99xxxx format — e.g. "Z990001", "Z990042"
