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

## Always-On Rules

Critical rules (server/client boundary, route registration, HTTP logging, status categorization, external links, user display, test conventions, verification guard) → `.github/copilot-instructions.md`

## Module Structure

- **GitHub API** `app/lib/github/` — `client.server.ts`, `pr.server.ts`, `git.server.ts`, `legacy.server.ts`, `index.ts`
- **Deployments DB** `app/db/deployments/` — `stats`, `notifications`, `home`, `status-history` (barrel: `deployments.server.ts`)
- **Slack** `app/lib/slack/` — `client.server.ts`, `blocks.ts`, `block-kit-url.ts`, `index.ts`
- **Sync** `app/lib/sync/` — `scheduler`, `log-cache`, `log-cache-job`, `goal-keyword-sync`, `index`

## Scoped Rules

Loaded automatically when editing relevant files:

| Area | Instruction file |
|------|-----------------|
| Verification logic | `.github/instructions/verification.instructions.md` |
| Authorization / RBAC | `.github/instructions/authorization.instructions.md` |
| Routes | `.github/instructions/routes.instructions.md` |
| Storybook / Components | `.github/instructions/storybook.instructions.md` |
| HTTP logging | `.github/instructions/http-logging.instructions.md` |
