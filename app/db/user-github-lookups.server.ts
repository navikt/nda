/**
 * GitHub account lookup functions backed by `user_github_accounts JOIN users`.
 *
 * Historical note: previously this data came from the `user_mappings` table.
 * As part of the expand/contract migration (steps 5a–5c) all lookups are
 * being moved here.
 */

import { isValidNavIdent } from '~/lib/form-validators'
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

/**
 * User record resolved from `users` + `user_github_accounts`.
 *
 * `github_username` is null when the user has no linked GitHub account.
 * Soft-deleted rows are included so historical deployment displays still work.
 */
export interface UserRecord {
  github_username: string | null
  display_github_username: string | null
  nav_ident: string
  display_name: string | null
  nav_email: string | null
  slack_member_id: string | null
}

/**
 * Get a user by GitHub username or NAV-ident.
 *
 * Uses the identifier format to decide which table to query:
 * - NAV-ident (one letter + 6 digits): looks up `users` and joins the newest
 *   active GitHub account (if any).
 * - Anything else: treated as a GitHub username and looked up in
 *   `user_github_accounts` (including soft-deleted rows so historical
 *   deployments can still resolve display names).
 */
export async function getUserByIdentifier(identifier: string): Promise<UserRecord | null> {
  if (isValidNavIdent(identifier)) {
    const result = await pool.query<UserRecord>(
      `SELECT u.nav_ident,
              u.display_name,
              u.nav_email,
              u.slack_member_id,
              uga.github_username,
              uga.display_github_username
       FROM users u
       LEFT JOIN LATERAL (
         SELECT github_username, display_github_username
         FROM user_github_accounts
         WHERE nav_ident = u.nav_ident AND deleted_at IS NULL
         ORDER BY created_at DESC, github_username
         LIMIT 1
       ) uga ON true
       WHERE u.nav_ident = UPPER($1) AND u.deleted_at IS NULL`,
      [identifier],
    )
    // If found as a NAV-ident, return immediately. Otherwise fall through to GitHub
    // username lookup: GitHub allows usernames that match NAV-ident format (e.g. "a123456").
    if (result.rows[0]) return result.rows[0]
  }

  const result = await pool.query<UserRecord>(
    `SELECT uga.github_username,
            uga.display_github_username,
            u.nav_ident,
            u.display_name,
            u.nav_email,
            u.slack_member_id
     FROM user_github_accounts uga
     JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE uga.github_username = LOWER($1)`,
    [identifier],
  )
  return result.rows[0] ?? null
}

/**
 * Get multiple users by a mix of GitHub usernames and NAV-idents.
 *
 * Returns a Map keyed by the original identifier (preserving casing).
 * Soft-deleted users (users.deleted_at IS NOT NULL) are excluded, consistent
 * with getUserByIdentifier(). Soft-deleted account links (user_github_accounts.deleted_at)
 * are still searched when looking up by GitHub username.
 *
 * Both queries run for all identifiers regardless of format to handle GitHub
 * usernames that look like NAV-idents (e.g. "a123456"). NAV-ident results
 * take precedence; GitHub username results are used as fallback.
 */
export async function getUsersByIdentifiers(identifiers: string[]): Promise<Map<string, UserRecord>> {
  if (identifiers.length === 0) return new Map()

  const navIdents = identifiers.filter((id) => isValidNavIdent(id)).map((id) => id.toUpperCase())
  // All identifiers are searched as GitHub usernames to handle usernames that
  // look like NAV-idents (e.g. "a123456").
  const allAsGithubUsernames = identifiers.map((id) => id.toLowerCase())

  const byNavIdent = new Map<string, UserRecord>()
  const byGithubUsername = new Map<string, UserRecord>()

  if (navIdents.length > 0) {
    const result = await pool.query<UserRecord>(
      `SELECT u.nav_ident,
              u.display_name,
              u.nav_email,
              u.slack_member_id,
              uga.github_username,
              uga.display_github_username
       FROM users u
       LEFT JOIN LATERAL (
         SELECT github_username, display_github_username
         FROM user_github_accounts
         WHERE nav_ident = u.nav_ident AND deleted_at IS NULL
         ORDER BY created_at DESC, github_username
         LIMIT 1
       ) uga ON true
       WHERE u.nav_ident = ANY($1) AND u.deleted_at IS NULL`,
      [navIdents],
    )
    for (const row of result.rows) {
      byNavIdent.set(row.nav_ident.toUpperCase(), row)
    }
  }

  const result = await pool.query<UserRecord>(
    `SELECT uga.github_username,
            uga.display_github_username,
            u.nav_ident,
            u.display_name,
            u.nav_email,
            u.slack_member_id
     FROM user_github_accounts uga
     JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE uga.github_username = ANY($1)`,
    [allAsGithubUsernames],
  )
  for (const row of result.rows) {
    if (row.github_username) {
      byGithubUsername.set(row.github_username.toLowerCase(), row)
    }
  }

  const mappings = new Map<string, UserRecord>()
  for (const identifier of identifiers) {
    // Prefer NAV-ident match; fall back to GitHub username match so that
    // identifiers like "a123456" that match NAV-ident format but are actually
    // GitHub usernames are still resolved correctly.
    const record = byNavIdent.get(identifier.toUpperCase()) ?? byGithubUsername.get(identifier.toLowerCase())
    if (record) {
      mappings.set(identifier, record)
    }
  }
  return mappings
}
