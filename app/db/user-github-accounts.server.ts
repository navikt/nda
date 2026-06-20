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
