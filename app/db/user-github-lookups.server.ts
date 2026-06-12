/**
 * GitHub account lookup functions backed by `user_github_accounts JOIN users`.
 *
 * These functions look up users **by GitHub username only**. They are NOT
 * drop-in replacements for `getUserMapping`/`getUserMappings` in the general
 * case — those functions also support NAV-ident lookups and are still needed
 * for routes that receive mixed identifiers (step 5b).
 *
 * Historical note: previously this data came from the `user_mappings` table.
 * As part of the expand/contract migration (step 5a) all GitHub-username-only
 * lookups are being moved here.
 */

import { pool } from './connection.server'

/**
 * Resolved GitHub account with associated user data.
 *
 * `account_deleted_at` reflects `user_github_accounts.deleted_at` — non-null
 * means the GitHub account link has been removed. Rows with a non-null
 * `account_deleted_at` are still returned so that historical deployments can
 * resolve display names even after an account is unlinked.
 */
export interface GithubUserLookup {
  github_username: string
  display_github_username: string | null
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
  account_deleted_at: Date | null
}

/**
 * Get a single user by GitHub username.
 *
 * Includes soft-deleted `user_github_accounts` rows so that historical
 * deployment lookups can still resolve a display name even after a GitHub
 * account has been unlinked.
 */
export async function getGithubUserLookup(githubUsername: string): Promise<GithubUserLookup | null> {
  const result = await pool.query<GithubUserLookup>(
    `SELECT uga.github_username,
            uga.display_github_username,
            u.display_name,
            u.nav_email,
            uga.nav_ident,
            u.slack_member_id,
            uga.deleted_at AS account_deleted_at
     FROM user_github_accounts uga
     LEFT JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE uga.github_username = LOWER($1)`,
    [githubUsername],
  )
  return result.rows[0] ?? null
}

/**
 * Get multiple users by GitHub username.
 *
 * Returns a Map keyed by the original identifier (preserving casing).
 * Includes soft-deleted `user_github_accounts` rows for historical lookups.
 */
export async function getGithubUserLookups(githubUsernames: string[]): Promise<Map<string, GithubUserLookup>> {
  if (githubUsernames.length === 0) return new Map()

  const result = await pool.query<GithubUserLookup>(
    `SELECT uga.github_username,
            uga.display_github_username,
            u.display_name,
            u.nav_email,
            uga.nav_ident,
            u.slack_member_id,
            uga.deleted_at AS account_deleted_at
     FROM user_github_accounts uga
     LEFT JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE uga.github_username = ANY($1)`,
    [githubUsernames.map((u) => u.toLowerCase())],
  )

  const byUsername = new Map<string, GithubUserLookup>()
  for (const row of result.rows) {
    byUsername.set(row.github_username, row)
  }

  const lookups = new Map<string, GithubUserLookup>()
  for (const identifier of githubUsernames) {
    const row = byUsername.get(identifier.toLowerCase())
    if (row) {
      lookups.set(identifier, row)
    }
  }

  return lookups
}

/**
 * Get the active GitHub account for a user identified by NAV-ident.
 *
 * Returns null if the user has no active (non-deleted) GitHub account linked.
 * When a user has multiple accounts, the most recently created one is returned.
 */
export async function getActiveGithubAccountByNavIdent(
  navIdent: string,
): Promise<{ github_username: string; display_github_username: string | null } | null> {
  const result = await pool.query<{ github_username: string; display_github_username: string | null }>(
    `SELECT uga.github_username, uga.display_github_username
     FROM user_github_accounts uga
     WHERE uga.nav_ident = UPPER($1) AND uga.deleted_at IS NULL
     ORDER BY uga.created_at DESC, uga.github_username
     LIMIT 1`,
    [navIdent],
  )
  return result.rows[0] ?? null
}

/**
 * Get a user by Slack member ID, including their active GitHub username if linked.
 *
 * Returns null if no active user with this Slack member ID exists.
 * When the user has multiple GitHub accounts, the most recently created active one is returned.
 */
export async function getUserBySlackMemberId(
  slackMemberId: string,
): Promise<{ nav_ident: string; github_username: string | null } | null> {
  const result = await pool.query<{ nav_ident: string; github_username: string | null }>(
    `SELECT u.nav_ident, uga.github_username
     FROM users u
     LEFT JOIN LATERAL (
       SELECT github_username
       FROM user_github_accounts
       WHERE nav_ident = u.nav_ident AND deleted_at IS NULL
       ORDER BY created_at DESC, github_username
       LIMIT 1
     ) uga ON true
     WHERE u.slack_member_id = $1 AND u.deleted_at IS NULL
     ORDER BY u.nav_ident
     LIMIT 1`,
    [slackMemberId],
  )
  return result.rows[0] ?? null
}
