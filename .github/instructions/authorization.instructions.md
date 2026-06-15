---
applyTo: "app/lib/authorization*,app/db/role-assignments*"
---

# Authorization (RBAC)

Key files:
- `authorization-types.ts` — `SECTION_ROLES`, `TEAM_ROLES` constants
- `authorization.server.ts` — Stateless helpers (`canAssignTeamRole`, `resolveTeamAdminCapabilities`, etc.)
- `role-assignments.server.ts` — CRUD (assign, soft-delete, query)

## Testing

When modifying auth logic or role queries, update `app/db/__tests__/integration/authorization.test.ts`.
Cover: admin access (Entra ID), each authorized role, unauthorized roles, inactive/soft-deleted resources.

## Patterns

**Single-pass auth**: Use `resolve*Capabilities()` — returns all booleans in one DB round-trip. Never call multiple `can*()` functions separately.

**Capability flags for UI**: Compute booleans in loaders, pass to client. Do not render elements that will return 403.

**Data minimization**: Resolve capabilities *before* running dependent queries. Skip queries entirely when the capability is absent. Strip internal metadata (DB IDs, timestamps) before returning to client.

**Named `Promise.all`**: Always destructure by name — never positional index casting (`data[0] as SomeType`).

**Route parameter validation**: `Number.isFinite()` after `parseInt()`, throw 400 for invalid values, never pass NaN to DB.

**IDOR scoping**: Scoping parameters must be **required**, not optional. Add integration tests verifying wrong scope → rejected.

**Mutation return values**: DB mutations that may no-op return `boolean`. Actions must check — do not return `{ success }` when nothing was modified.

**Action errors**: `return { error: '...' }` or `fail()` for user errors. Only `throw new Response(400)` for invalid params (bugs).
