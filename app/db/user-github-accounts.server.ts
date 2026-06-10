import { pool } from '~/db/connection.server'

function normalize(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeNavIdent(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toUpperCase()
  return trimmed || null
}

interface UserGithubAccount {
  github_username: string
  display_github_username: string | null
  nav_ident: string
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  deleted_by: string | null
}

/**
 * Create or update a GitHub account link in the `user_github_accounts` table.
 * The users row for nav_ident must already exist (FK constraint).
 *
 * displayGithubUsername semantics:
 * - Omitted (undefined): defaults to githubUsername (preserves original casing from the caller).
 * - Explicitly null: stored as null (clears display casing on INSERT; on conflict COALESCE
 *   preserves the existing value rather than overwriting with null).
 * - Provided string: must match githubUsername case-insensitively, or an error is thrown.
 *
 * On conflict (same github_username already exists), display_github_username is only updated
 * when the new value is non-null — a null value leaves the existing display casing intact.
 */
export async function upsertUserGithubAccount(params: {
  githubUsername: string
  displayGithubUsername?: string | null
  navIdent: string
}): Promise<UserGithubAccount> {
  const githubUsername = normalize(params.githubUsername)?.toLowerCase() ?? null
  if (!githubUsername) throw new Error('GitHub username is required')
  const navIdent = normalizeNavIdent(params.navIdent)
  if (!navIdent) throw new Error('nav_ident is required')
  const displayGithubUsername =
    params.displayGithubUsername !== undefined
      ? (normalize(params.displayGithubUsername) ?? null)
      : (normalize(params.githubUsername) ?? null)

  if (displayGithubUsername && displayGithubUsername.toLowerCase() !== githubUsername) {
    throw new Error(
      `display_github_username '${displayGithubUsername}' does not match github_username '${githubUsername}'`,
    )
  }

  const result = await pool.query<UserGithubAccount>(
    `INSERT INTO user_github_accounts (github_username, display_github_username, nav_ident, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (github_username) DO UPDATE SET
       display_github_username = COALESCE(EXCLUDED.display_github_username, user_github_accounts.display_github_username),
       nav_ident               = EXCLUDED.nav_ident,
       updated_at              = NOW(),
       deleted_at              = NULL,
       deleted_by              = NULL
     RETURNING *`,
    [githubUsername, displayGithubUsername, navIdent],
  )
  return result.rows[0]
}

/**
 * Backfill user_github_accounts from user_mappings.
 * Seeds all active user_mappings rows that have a matching active users row.
 * Idempotent — safe to run multiple times.
 * Returns the number of rows inserted/updated and how many were skipped
 * (no active users row — either missing or soft-deleted).
 */
export async function populateGithubAccountsFromMappings(): Promise<{
  inserted: number
  skipped: number
}> {
  const eligibleResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM user_mappings um
     WHERE um.deleted_at IS NULL
       AND um.nav_ident IS NOT NULL`,
  )
  const eligible = Number(eligibleResult.rows[0].count)

  const upsertResult = await pool.query<{ count: string }>(
    `WITH upserted AS (
       INSERT INTO user_github_accounts (github_username, display_github_username, nav_ident)
       SELECT um.github_username, um.display_github_username, um.nav_ident
       FROM user_mappings um
       INNER JOIN users u ON u.nav_ident = um.nav_ident AND u.deleted_at IS NULL
       WHERE um.deleted_at IS NULL
         AND um.nav_ident IS NOT NULL
       ON CONFLICT (github_username) DO UPDATE SET
         nav_ident               = EXCLUDED.nav_ident,
         display_github_username = COALESCE(EXCLUDED.display_github_username, user_github_accounts.display_github_username),
         updated_at              = NOW(),
         deleted_at              = NULL,
         deleted_by              = NULL
       RETURNING github_username
     )
     SELECT COUNT(*) AS count FROM upserted`,
  )
  const inserted = Number(upsertResult.rows[0].count)

  return { inserted, skipped: Math.max(0, eligible - inserted) }
}
