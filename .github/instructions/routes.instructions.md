---
applyTo: "app/routes/**"
---

# Route Conventions

## Route Registration (CRITICAL)

Routes are **not** auto-discovered. A file in `app/routes/` requires a `route()` entry in `app/routes.ts` or it 404s in production.

After adding the entry, run `pnpm exec react-router typegen` and import the generated type:
```ts
import type { Route } from './+types/my-new-route'
```

New routes are validated automatically by `app/lib/__tests__/routes.test.ts`. Add dedicated tests for non-trivial loader/action logic.

## Action Extraction

Large route files split action handlers into `*.actions.server.ts`:
```ts
export { action } from './$id.actions.server'
```

## Action Results & Feedback

Use `ok(message)` / `fail(message)` from `app/lib/action-result.ts`. Render with `<ActionAlert data={actionData} />`.

Error paths: `return { error: '...' }` or `fail()`. Only `throw new Response(400)` for bugs (invalid route params), not user errors.

## Route Utilities

- `requireTeamEnvAppParams(params)` / `requireParams(params, keys)` — extract and validate route params, throw 400 if missing
- `getFormString(formData, key)` — safe FormData read; trims, returns null for File values
- Validators: `isValidEmail()`, `isValidNavIdent()`, `isValidSlackChannel()`

## Required UI Components

- **`<ExternalLink href={...}>`** — required for ALL external URLs (GitHub, NAIS Console, Slack, Teamkatalogen, etc.). Never use raw `<a target="_blank">`.
- **`<UserName username={x} userMappings={m} />`** — always for deployer/reviewer display. Never show raw GitHub usernames in deployment/commit contexts.
