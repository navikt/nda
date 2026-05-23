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

### Status Categorization — Single Source of Truth

**All status categorization MUST use the canonical helpers from `app/lib/four-eyes-status.ts`.** This file is the single source of truth for which statuses are approved, pending, not approved, or legacy. No other file may define its own lists or inline checks for status categories.

**Canonical helpers for TypeScript logic:**
- `isApprovedStatus(status)` — Is this deployment approved?
- `isPendingStatus(status)` — Is this deployment pending verification?
- `isNotApprovedStatus(status)` — Is this deployment explicitly not approved?
- `isLegacyStatus(status)` — Is this a legacy deployment?
- `isProtectedStatus(status)` — Is this status protected from re-verification?

**Canonical constants for SQL queries:**
- `APPROVED_STATUSES` / `APPROVED_STATUSES_SQL` — Use in SQL `IN` clauses
- `PENDING_STATUSES` / `PENDING_STATUSES_SQL` — Use in SQL `IN` clauses

```typescript
// ✅ Good: uses canonical helper
import { isApprovedStatus, isLegacyStatus } from '~/lib/four-eyes-status'
const approved = deployments.filter((d) => isApprovedStatus(d.four_eyes_status))

// ❌ Bad: defines own inline list (WILL diverge when new statuses are added)
const approved = deployments.filter(
  (d) => d.four_eyes_status === 'approved' || d.four_eyes_status === 'manually_approved'
)
```

**Exception:** Checking a *specific* status for method/display categorization is fine (e.g., `=== 'manually_approved'` to determine if a deployment was manually vs PR-approved). The rule applies to *category* checks — "is this approved?", "is this pending?", etc.

**Rationale:** A bug where `checkAuditReadiness()` defined its own approved-statuses list caused audit report counts to diverge from actual verification data. Audit reports are compliance evidence — this class of bug must be structurally prevented.

### Archived Reports

Audit reports can be archived (soft-delete with reason). **Archived reports must never be visible in public-facing views or M2M APIs.** Specifically:

- `getAuditReportsForApp()` excludes archived reports — used on the app page (public)
- `getAuditReportsForAppAdmin()` includes archived reports — used on admin pages only
- Admin PDF routes (`/admin/audit-reports/:id/view` and `/pdf`) still serve archived reports (admin-only access)
- Any new API endpoint that lists or serves reports must respect the `archived_at IS NULL` filter unless it is explicitly admin-only

## Authorization (RBAC) Architecture

The application uses role-based access control with section-level and team-level roles. Authorization helpers live in `app/lib/authorization.server.ts`.

### Testing Requirement

When modifying authorization logic (`app/lib/authorization.server.ts`) or role assignment queries (`app/db/role-assignments.server.ts`), always add or update integration tests in `app/db/__tests__/integration/authorization.test.ts`. Cover:

- Admin access (Entra ID-based)
- Each authorized role (e.g., produktleder, seksjonsleder)
- Unauthorized roles (should be denied)
- Inactive/soft-deleted resources

### Loader/Action Authorization Patterns

**Single-pass auth helpers**: When a route needs multiple authorization checks, use a single `resolve*Capabilities()` function that returns all booleans in one DB round-trip. Do NOT call multiple `can*()` functions that each query `getUserRoles()` separately.

```typescript
// ✅ Good: single DB pass returning all capabilities
const { canAccess, canAdmin } = await resolveTeamAdminCapabilities(user, devTeamId)

// ❌ Bad: two separate DB round-trips
const access = await canAccessTeamAdmin(user, devTeamId)
const admin = await canAdministerTeam(user, devTeamId)
```

**Capability flags for UI gating**: Loaders should compute capability booleans and pass them to the client. Do NOT render buttons or actions that will return 403 — gate them with capability flags.

**Data minimization**: When a route is accessible to multiple roles with different privileges, only fetch data relevant to the user's actual capabilities. Do NOT load admin-only data for non-admin users. Resolve capabilities *before* running queries that depend on them — skip the queries entirely when the user lacks the required capability, rather than running the queries and discarding the results. When returning data to the client, strip internal metadata (e.g., database IDs, role assignment timestamps) that the UI doesn't need — map to a minimal shape in the loader before returning.

**Named Promise.all results**: When using `Promise.all` for parallel data fetching, always use named destructuring or named variables. Never use positional index casting.

```typescript
// ✅ Good: named variables
const [members, apps, boards] = await Promise.all([getMembers(), getApps(), getBoards()])

// ❌ Bad: positional casting
const data = await Promise.all([getMembers(), getApps(), getBoards()])
const members = data[0] as MemberType[]
```

**Route parameter validation**: Always validate parsed route parameters early in loaders and actions. Use `Number.isFinite()` after `parseInt()` and throw a 400 Response for invalid values. Do NOT pass NaN to database queries.

```typescript
// ✅ Good: validate early
const deploymentId = parseInt(params.id ?? '', 10)
if (!Number.isFinite(deploymentId)) {
  throw new Response('Ugyldig deployment-ID', { status: 400 })
}

// ❌ Bad: pass potentially NaN to DB
const deploymentId = parseInt(params.id ?? '', 10)
await getDeploymentById(deploymentId) // NaN → unexpected behavior
```

**IDOR scoping as required parameters**: When a DB mutation function accepts a scoping parameter for IDOR protection (e.g., `deploymentId` on `deleteComment`), make it **required**, not optional. Optional scoping can be silently omitted by future callers, defeating the protection. Always add an integration test that verifies the scoping works (correct ID + wrong scope → rejected).

**Mutation return values**: DB mutation functions that may no-op (e.g., soft-delete on already-deleted row, scoped update with wrong ID) should return `boolean`. Actions must check the return value and return appropriate error messages — do NOT return `{ success }` when nothing was actually modified.

**Consistent action error responses**: All error paths in route actions should use `return { error: '...' }` (or the `fail()` helper), never `throw new Response(...)`. Thrown responses bypass `ActionAlert` and trigger error boundaries, giving inconsistent UX. Exception: input validation errors (e.g., missing/invalid route params) may throw `new Response(..., { status: 400 })` since they indicate a bug, not a user error.

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
- `goal-keyword-sync.server.ts` — Auto-links deployments to goals via commit message keywords
- `index.ts` — Re-exports

### Outgoing HTTP Logging (REQUIRED for all new HTTP calls)

All outgoing HTTP calls **must** be logged using the shared helpers in `app/lib/logger.server.ts`. This enables ELK monitoring and filtering of all outbound traffic.

**Filter in ELK:** `type: outgoing_http` — use `area` to narrow to a specific integration.

#### Helpers

**`fetchWithLogging(area, url, options?)`** — drop-in replacement for `fetch`. Logs method, host, path, status_code, and duration_ms automatically. Query strings are always stripped from the logged path to avoid capturing user-supplied data (e.g. Graph `$filter` values with NAV-idents).

```ts
import { fetchWithLogging } from '~/lib/logger.server'

const response = await fetchWithLogging('nais_auth', endpointUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

**`logOutgoingHttp(details)`** — log a single structured entry manually. Use this when the HTTP client has its own hook system (Octokit, Slack Bolt, graphql-request).

```ts
import { logOutgoingHttp } from '~/lib/logger.server'

logOutgoingHttp({
  area: 'github',
  method: 'GET',
  host: 'api.github.com',
  path: '/repos/navikt/myapp/pulls/42',
  status_code: 200,
  duration_ms: 145,
})
```

#### Area values

| `area` | Integration | How it logs |
|--------|-------------|-------------|
| `github` | GitHub API (Octokit) | `hook.wrap` in `client.server.ts` |
| `slack` | Slack Web API (Bolt) | `callSlackApi()` wrapper in `slack/client.server.ts` |
| `microsoft_graph` | Microsoft Graph + NAIS token | `fetchWithLogging` in `microsoft-graph.server.ts` |
| `nais_auth` | NAIS M2M token introspection | `fetchWithLogging` in `m2m-auth.server.ts` |
| `nais_graphql` | NAIS GraphQL API | custom `fetch:` adapter in `nais.server.ts` |

#### Rules

- **New `fetch` call** → use `fetchWithLogging` instead of raw `fetch`
- **New client with hook system** (Octokit-style, graphql-request) → pass `fetchWithLogging` as a custom fetch adapter, or call `logOutgoingHttp` inside the hook
- **Never log Authorization headers, tokens, or query strings** — only method, host, and pathname
- Add the new area value to the `OutgoingHttpArea` union in `logger.server.ts` if introducing a new integration

### Goal Keyword Auto-Linking

Commit messages are scanned for keywords defined on board objectives and key results. The system:

1. Extracts commit messages from deployment data (PR title, unverified commits, PR commits)
2. Loads keywords from active boards belonging to the deployment's team
3. Matches keywords case-insensitively against commit messages
4. Rejects ambiguous matches (keyword appears in 2+ boards)
5. Creates `deployment_goal_links` with `link_method = 'commit_keyword'`

Key files:
- `app/lib/goal-keyword-matcher.ts` — Pure matching function (no DB/network)
- `app/lib/sync/goal-keyword-sync.server.ts` — Orchestration (DB queries + matcher)
- `app/lib/__tests__/goal-keyword-matcher.test.ts` — 14 unit tests

### Verification (`app/lib/verification/`)

Business logic for four-eyes verification:

- `verify.ts` — Main verification engine including `checkImplicitApproval`
- `fetch-data.server.ts` — GitHub data fetching for verification
- `types.ts` — Shared types and constants

### Authorization / RBAC (`app/lib/authorization*.ts`, `app/db/role-assignments.server.ts`)

Role-based access control for the application:

- `authorization-types.ts` — Role constants (`SECTION_ROLES`, `TEAM_ROLES`) and TypeScript types
- `authorization.server.ts` — Stateless authorization helpers (`canAssignTeamRole`, `canApproveDeployment`, `resolveTeamAdminCapabilities`, etc.)
- `role-assignments.server.ts` — CRUD for role assignments (assign, remove via soft-delete, query)

### Route Action Extraction Pattern

Large route files split their action handlers into `*.actions.server.ts` files:

- `routes/deployments/$id.actions.server.ts` — 14 deployment detail actions (with fail-closed auth gate)
- `routes/team/$team.env.$env.app.$app.admin.actions.server.ts` — App admin actions

The route re-exports: `export { action } from './$id.actions.server'`

### Route Registration (CRITICAL)

This app uses **explicit route definitions** in `app/routes.ts` — routes are **NOT** auto-discovered from the file system. When creating a new route file under `app/routes/`, you **must** also add a corresponding `route()` entry in `app/routes.ts`, or the route will 404 in production.

After adding the route entry, run `npx react-router typegen` to generate the `+types/` file, then import the generated `Route` type in the new route file:

```ts
import type { Route } from './+types/my-new-route'
```

### New Route Testing Requirement

When adding a new route, verify it is covered by the existing route tests in `app/lib/__tests__/routes.test.ts`. This test suite automatically validates all routes registered in `app/routes.ts`:

1. **File exists on disk** — the route file referenced in `routes.ts` must exist
2. **Has exports** — the route file must export a `default` component, `loader`, or `action`

Since the test iterates over `app/routes.ts`, registering the route there is sufficient for test coverage. However, if the route has non-trivial loader/action logic, add dedicated unit or integration tests for that logic.

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

### UserName Component (`app/components/UserName.tsx`)

Renders a GitHub username as a display name (full name from user mappings, with fallback to GitHub username). Use this component whenever displaying a person's identity in deployment/commit contexts (deployer, PR creator, PR merger, reviewers, nearby deploys).

```tsx
import { UserName } from '~/components/UserName'

// Internal link to /users/:username (default)
<UserName username={deployer} userMappings={userMappings} />

// External link to GitHub profile
<UserName username={deployer} userMappings={userMappings} link="github" />

// No link (plain text)
<UserName username={deployer} userMappings={userMappings} link={false} />
```

**When to use `UserName` vs `getUserDisplayName()`:**
- Use `<UserName>` in JSX for rendering a single user identity
- Use `getUserDisplayName()` for complex cases: alt text, `.map().join()`, string concatenation, or anywhere a React component cannot be used

**Do NOT** display raw GitHub usernames (`deployer_username`) directly in deployment/commit UI. Always resolve through `UserName` or `getUserDisplayName()`. Raw usernames are appropriate only on user mapping/admin pages where the GitHub identity itself is the relevant information.

### ExternalLink Component (`app/components/ExternalLink.tsx`)

**ALL links that point to a different site (external domain) MUST use `<ExternalLink>`.**
The component automatically applies `target="_blank"`, `rel="noopener noreferrer"` and
appends Aksel's `ExternalLinkIcon` so the user can see that the link opens elsewhere.

```tsx
import { ExternalLink } from '~/components/ExternalLink'

<ExternalLink href={`https://github.com/${owner}/${repo}`}>
  {owner}/{repo}
</ExternalLink>
```

**Do NOT** use raw `<a target="_blank">` or `<Link target="_blank">` from
`@navikt/ds-react` for external URLs — they will be missing the icon and/or
the `rel` attributes.

**Examples of external destinations** that require `<ExternalLink>`:
- `https://github.com/...` (PRs, commits, branches, profiles, repos)
- `https://console.nav.cloud.nais.io/...` (NAIS Console)
- `https://nav-it.slack.com/...` and other Slack URLs
- `https://teamkatalogen.nav.no/...`
- Any third-party `external_url` (board reference URLs, audit log URLs, etc.)

**Internal links** that open in a new tab (same origin, e.g.
`/admin/audit-reports/123/pdf`) do NOT need the icon — keep using
`<Link to=... target="_blank">` from React Router for those.

## Storybook & Component Extraction

**This is the standard approach for all new UI work going forward.**

### Principle

Route files (`app/routes/`) should be thin orchestrators — loaders, actions, and a thin component shell that composes extracted components. Non-trivial UI should live in `app/components/` so it can be:

1. Imported in Storybook stories without mocking loaders/actions
2. Reused across routes
3. Tested in isolation

### How to Extract

1. **Identify non-trivial UI** in a route file (tables, modals, forms with state, complex card layouts)
2. **Extract to `app/components/ComponentName.tsx`** — accept data via props instead of `useLoaderData()`
3. **Keep `Form` from react-router** in extracted components — it works in Storybook via the `createMemoryRouter` wrapper in `.storybook/preview.tsx`
4. **Export the component and its prop types** (interfaces for the data it needs)
5. **Update the route** to import and render the component, passing loader data as props
6. **Write Storybook stories** that import the component directly — no JSX duplication

### Story Location

Stories live alongside routes in `app/routes/__stories__/`. The glob pattern `../app/**/*.stories.@(ts|tsx)` picks them up.

### Story Pattern

```tsx
import type { Meta, StoryObj } from '@storybook/react'
import { MyComponent } from '~/components/MyComponent'

const meta: Meta<typeof MyComponent> = {
  title: 'Features/MyComponent',
  component: MyComponent,
}
export default meta
type Story = StoryObj<typeof MyComponent>

export const Default: Story = {
  args: {
    // Pass mock data matching the component's props
    items: [{ id: 1, name: 'Example' }],
  },
}
```

### Anti-Pattern (Do NOT Do This)

Do NOT duplicate route JSX inline in stories. If you find yourself copy-pasting JSX from a route into a story, you need to extract a component first.

### Test Person Names

All fictional person names in stories, tests, and mock data must use the format **"Adjektiv Substantiv"** (Norwegian adjective + noun). Examples: "Glad Fjord", "Rask Elv", "Stille Skog", "Modig Bjørk". Do NOT use real-sounding Norwegian names like "Ola Nordmann" or "Kari Hansen".

