---
applyTo: "app/lib/**,app/db/**"
---

# Outgoing HTTP Logging

All outgoing HTTP calls must use helpers from `app/lib/logger.server.ts` — enables ELK monitoring (`log_type: outgoing_http`).

## Rules

- **New `fetch` call** → use `fetchWithLogging(area, url, options?)` instead of raw `fetch`
- **New client with hook system** (Octokit, Slack Bolt, graphql-request) → pass `fetchWithLogging` as custom fetch adapter or call `logOutgoingHttp()` inside the hook
- **Never log** Authorization headers, tokens, or query strings (query strings are auto-stripped)
- Add new area values to the `OutgoingHttpArea` union in `logger.server.ts` when introducing a new integration

## Area Values

| `area` | Integration |
|--------|-------------|
| `github` | GitHub API (Octokit) |
| `slack` | Slack Web API (Bolt) |
| `microsoft_graph` | Microsoft Graph + NAIS token |
| `nais_auth` | NAIS M2M token introspection |
| `nais_graphql` | NAIS GraphQL API |
