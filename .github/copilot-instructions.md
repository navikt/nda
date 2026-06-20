# NDA — GitHub Copilot Instructions

React Router v7 (framework mode) + TypeScript + PostgreSQL + Slack Bolt + Nais/GCP.

## Tech Stack

- **Frontend/Backend**: React Router v7 (SSR), `app/routes/` for routes, `app/components/` for reusable UI
- **UI**: Aksel Design System (`@navikt/ds-react`) — always use Aksel components
- **DB**: PostgreSQL via `pg`, migrations with node-pg-migrate in `app/db/migrations/`
- **Auth**: Azure AD (internal), TokenX (service-to-service), ID-porten (citizens)
- **Infra**: Nais (GCP), Slack Bolt, Octokit

## Critical Rules

### Server/Client Boundary
Files ending in `.server.ts` are server-only. Cannot be imported by components or hooks.

### External Links
Always use `<ExternalLink href={...}>` — never raw `<a target="_blank">`. Handles `rel`, icon automatically.

### User Display
Always use `<UserName username={x} userMappings={m} />` for GitHub usernames in deployment/commit UI.

### Route Registration
Explicit routes in `app/routes.ts` — not auto-discovered. New route file requires `route()` entry + `pnpm exec react-router typegen`.

### Action Results
`ok(message)` / `fail(message)` from `app/lib/action-result.ts`. Render with `<ActionAlert data={actionData} />`. Error paths: `return { error: '...' }` or `fail()` — never `throw new Response()` for user errors (only for invalid params/bugs).

### Status Categorization
Use helpers from `app/lib/four-eyes-status.ts` (`isApprovedStatus()` etc.) — never inline status lists.

### HTTP Logging
All outgoing HTTP calls must emit structured logs via `app/lib/logger.server.ts`: use `fetchWithLogging()` as a drop-in for `fetch()`, or `logOutgoingHttp()` inside hook-based clients (Octokit, Slack Bolt). Never use raw `fetch()` without logging.

### Authorization Patterns
- Single-pass auth: use `resolve*Capabilities()` for all capability checks in one DB round-trip
- Mutation functions that may no-op must return `boolean` — actions must check the value
- Named `Promise.all`: always destructure by name — never positional index casting (`data[0] as Type`)
- Route param validation: `Number.isFinite()` after `parseInt()`, throw 400 for invalid values

## Verification System

Four-eyes principle check on all deployments. **Do not modify `app/lib/verification/verify.ts` without user confirmation.** See `docs/verification.md`. Archived reports must never appear in public-facing views (`archived_at IS NULL`).

## Code Style

Never add code comments. Code should be self-documenting. No `//` comments, no `/* */` blocks, no JSDoc. Exception: suppression directives (`biome-ignore`, `eslint-disable`, `@ts-*`) must be kept as-is.

## Test Conventions

- Person names: "Adjektiv Substantiv" (e.g. "Glad Fjord")
- NAV-idents: Z99xxxx (e.g. "Z990001")
- Run: `pnpm run check` (lint + typecheck), `pnpm test` (vitest)
