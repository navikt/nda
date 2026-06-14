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
