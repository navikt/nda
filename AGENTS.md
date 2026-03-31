# Agent Instructions

## Before Committing

Run all checks before committing changes:

```bash
pnpm run lint && pnpm run check && pnpm test && pnpm run knip && pnpm run build && pnpm run build-storybook
```

This runs:

1. **Lint** (`biome check .`) — code formatting and linting
2. **Check** (`pnpm run lint && pnpm run typecheck`) — lint + TypeScript type checking
3. **Test** (`vitest run`) — unit and integration tests
4. **Knip** (`knip`) — detect unused files, dependencies, and exports
5. **Build** (`react-router build`) — production build
6. **Build Storybook** (`storybook build`) — Storybook build

All must pass before committing. Lint warnings must also be resolved — the codebase should have zero warnings.

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope?): subject
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

## Server/Client Boundary

This is a React Router app with server/client code splitting. Files ending in `.server.ts` are server-only and **cannot** be imported in client-side code (component default exports, hooks, etc.). Shared constants must live in non-server files (e.g., `app/db/sync-job-types.ts`).

## Four-Eyes Verification Architecture

The verification system checks that all deployments follow the four-eyes principle (at least two people involved in each code change).

**Full documentation**: See [`docs/verification.md`](docs/verification.md) for complete decision logic, statuses, and code references.

### Key Components

- **Pure verification logic**: `app/lib/verification/verify.ts` — stateless `verifyDeployment()` function, testable without DB/network
- **Orchestration**: `app/lib/verification/index.ts` — `runVerification()` (fetch → verify → store)
- **Types & enums**: `app/lib/verification/types.ts` — `VerificationStatus`, `UnverifiedReason`, `ImplicitApprovalMode`
- **Batch verification**: `app/lib/sync/github-verify.server.ts` — `verifyDeploymentsFourEyes()`
- **Periodic sync**: `app/lib/sync/scheduler.server.ts` — `startPeriodicSync()`

### Key Functions in verify.ts

- `verifyDeployment(input)`: Main entry point. Pure function with 9 decision steps (0a: repo, 0b: branch, 1-7: four-eyes).
- `verifyFourEyesFromPrData()`: Checks PR reviews against commits timeline.
- `shouldApproveWithBaseMerge()`: Detects base branch merge patterns.
- `checkImplicitApproval()`: Evaluates implicit approval rules (off/dependabot_only/all).

### Unit Tests

- `app/lib/__tests__/four-eyes-verification.test.ts` — PR review, squash merge, Dependabot scenarios
- `app/lib/__tests__/verify-coverage-gaps.test.ts` — All 7 decision steps in `verifyDeployment`, security gap tests
- `app/lib/__tests__/v1-unverified-reasons.test.ts` — Complex multi-commit scenarios

### Integration Tests

- `app/db/__tests__/integration/previous-deployment.test.ts` — Tests the `getPreviousDeployment` query (legacy filtering, invalid refs)

### Testing Requirement

When modifying verification logic (any file in `app/lib/verification/`, or verification-related queries in `app/lib/verification/fetch-data.server.ts`), always add or update tests that cover the change:

- **Pure logic changes** (`verify.ts`): Add unit tests in `app/lib/__tests__/`
- **Query/data-fetching changes** (`fetch-data.server.ts`): Add integration tests in `app/db/__tests__/integration/`
- **New verification statuses or reasons**: Add test cases covering the new paths

### Change Approval Requirement

**Always ask the user for confirmation before modifying the verification algorithm.** The verification system is critical for audit compliance — changes to decision logic in `verify.ts`, status handling, or how previous deployments are selected can have wide-reaching consequences. Present the proposed change and rationale, and wait for explicit approval before implementing.

### Documentation Requirement

When modifying verification logic in `app/lib/verification/verify.ts`, always update [`docs/verification.md`](docs/verification.md) to reflect the changes. This documentation is used by developers, managers, and auditors to understand the verification system.

## Module Structure

### GitHub API (`app/lib/github/`)

Split into focused modules:

- `client.server.ts` — Octokit client, GitHub App/PAT auth, rate limit logging
- `pr.server.ts` — PR lookup, reviews, four-eyes verification, rebase matching
- `git.server.ts` — Commit comparisons, branch checking
- `legacy.server.ts` — Legacy deployment GitHub lookups
- `index.ts` — Re-exports all public API

### Deployments DB (`app/db/deployments/`)

Submodules extracted from the main deployments file:

- `stats.server.ts` — App deployment statistics and batch queries
- `notifications.server.ts` — Slack notifications and reminder queries
- `home.server.ts` — Home tab summary and issue queries
- `status-history.server.ts` — Status transition logging and history

All re-exported from `app/db/deployments.server.ts` (barrel file).

### Slack (`app/lib/slack/`)

Slack integration grouped into focused modules:

- `client.server.ts` — Slack Bolt app, connection, message sending, notifications
- `blocks.ts` — Block Kit message builders (deployments, deviations, reminders, home tab)
- `block-kit-url.ts` — Block Kit Builder URL generation for previewing messages
- `index.ts` — Re-exports all public API

### Sync (`app/lib/sync/`)

Background sync job infrastructure:

- `scheduler.server.ts` — Cron-based job scheduling
- `log-cache.server.ts` — GitHub check log caching
- `log-cache-job.server.ts` — Locking wrapper for log cache operations
- `index.ts` — Re-exports

### Verification (`app/lib/verification/`)

Business logic for four-eyes verification:

- `verify.ts` — Main verification engine including `checkImplicitApproval`
- `fetch-data.server.ts` — GitHub data fetching for verification
- `types.ts` — Shared types and constants

### Route Action Extraction Pattern

Large route files split their action handlers into `*.actions.server.ts` files:

- `routes/deployments/$id.actions.server.ts` — 12 deployment detail actions
- `routes/team/$team.env.$env.app.$app.admin.actions.server.ts` — App admin actions

The route re-exports: `export { action } from './$id.actions.server'`

## Shared Route Utilities

### Form Validators (`app/lib/form-validators.ts`)

Shared validation functions used across route actions:

- `isValidEmail(email)` — validates email format
- `isValidNavIdent(ident)` — validates NAV ident format (letter + 6 digits)
- `isValidSlackChannel(channel)` — validates Slack channel ID or `#name` format

### Route Parameters (`app/lib/route-params.server.ts`)

Helpers for extracting and validating route parameters:

- `requireParams(params, keys)` — generic: throws 400 if any key is missing
- `requireTeamEnvParams(params)` — returns `{ team, env }`
- `requireTeamEnvAppParams(params)` — returns `{ team, env, app }`

### Action Results (`app/lib/action-result.ts`)

Standardized action response helpers:

- `ok(message)` — returns `{ success: message }`
- `fail(message)` — returns `{ error: message }`
- Use with `<ActionAlert data={actionData} />` component for consistent feedback UI

### ActionAlert Component (`app/components/ActionAlert.tsx`)

Renders success/error alerts from action data. Replaces the common pattern:

```tsx
// Before (duplicated in 12+ routes)
{actionData?.success && <Alert variant="success">{actionData.success}</Alert>}
{actionData?.error && <Alert variant="error">{actionData.error}</Alert>}

// After
<ActionAlert data={actionData} />
```
