/**
 * GitHub account lookup and write functions backed by `user_github_accounts JOIN users`.
 */

import { isValidNavIdent } from '~/lib/form-validators'
import { isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'

/**
 * Resolved GitHub account with associated user data.
 *
 * `account_deleted_at` reflects `user_github_accounts.deleted_at` — non-null
 * means the GitHub account link has been removed. Rows with a non-null
 * `account_deleted_at` are still returned so that historical deployments can
 * resolve display names even after an account is unlinked.
 */
interface GithubUserLookup {
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
interface UserRecord {
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
    const record = byNavIdent.get(identifier.toUpperCase()) ?? byGithubUsername.get(identifier.toLowerCase())
    if (record) {
      mappings.set(identifier, record)
    }
  }
  return mappings
}

/**
 * Shape returned by getAllUsersWithAccounts for admin list views.
 *
 * `github_username` is always set (INNER JOIN on user_github_accounts).
 * Users without a GitHub account appear in getUsersWithoutGithub() instead.
 */
export interface UserWithAccount {
  github_username: string
  display_github_username: string | null
  nav_ident: string
  display_name: string
  nav_email: string
  slack_member_id: string | null
  created_at: Date
  updated_at: Date
}

/**
 * Get all active users that have at least one active GitHub account linked.
 *
 * Returns one row per active `user_github_accounts` entry so users with
 * multiple GitHub accounts appear multiple times.
 */
export async function getAllUsersWithAccounts(): Promise<UserWithAccount[]> {
  const result = await pool.query<UserWithAccount>(
    `SELECT uga.github_username,
            uga.display_github_username,
            u.nav_ident,
            u.display_name,
            u.nav_email,
            u.slack_member_id,
            GREATEST(u.updated_at, uga.updated_at) AS updated_at,
            LEAST(u.created_at, uga.created_at) AS created_at
     FROM user_github_accounts uga
     JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
     WHERE uga.deleted_at IS NULL
     ORDER BY uga.github_username`,
  )
  return result.rows
}

/**
 * Get GitHub usernames from deployments that don't have an active GitHub
 * account link in `user_github_accounts`. Excludes known bots.
 */
export async function getUnmappedDeployers(): Promise<{ github_username: string; deployment_count: number }[]> {
  const result = await pool.query<{ github_username: string; deployment_count: string }>(`
    SELECT LOWER(d.deployer_username) AS github_username, COUNT(*) AS deployment_count
    FROM deployments d
    INNER JOIN monitored_applications ma
      ON d.monitored_app_id = ma.id AND ma.is_active = true
    LEFT JOIN user_github_accounts uga
      ON LOWER(d.deployer_username) = uga.github_username AND uga.deleted_at IS NULL
    WHERE d.deployer_username IS NOT NULL
      AND d.deployer_username != ''
      AND uga.github_username IS NULL
      AND ${AUDIT_START_YEAR_FILTER}
    GROUP BY LOWER(d.deployer_username)
    ORDER BY github_username
  `)
  return result.rows
    .filter((r) => !isGitHubBot(r.github_username))
    .map((r) => ({
      github_username: r.github_username,
      deployment_count: parseInt(r.deployment_count, 10),
    }))
}

/**
 * Soft-delete a GitHub account link.
 *
 * The corresponding `users` row is left intact — the person still exists,
 * just without a GitHub account link.
 *
 * Returns true if a row was actually deleted, false if it was already deleted
 * or not found.
 */
export async function softDeleteGithubAccount(
  githubUsername: string,
  deletedBy: string | null = null,
): Promise<boolean> {
  const result = await pool.query<{ github_username: string }>(
    `UPDATE user_github_accounts
     SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
     WHERE github_username = LOWER($1) AND deleted_at IS NULL
     RETURNING github_username`,
    [githubUsername.trim(), deletedBy],
  )
  return (result.rowCount ?? 0) > 0
}

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

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

interface User {
  nav_ident: string
  display_name: string
  nav_email: string
  slack_member_id: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  deleted_by: string | null
}

/**
 * Create or update a user in the `users` table.
 */
export async function upsertUser(params: {
  navIdent: string
  displayName: string
  navEmail: string
  slackMemberId?: string | null
}): Promise<User> {
  const navIdent = normalizeNavIdent(params.navIdent)
  const displayName = normalize(params.displayName)
  const navEmail = normalizeEmail(params.navEmail)
  const slackMemberId = normalize(params.slackMemberId)

  if (!navIdent) throw new Error('navIdent is required')
  if (!displayName) throw new Error('displayName is required')
  if (!navEmail) throw new Error('navEmail is required')

  const result = await pool.query<User>(
    `INSERT INTO users (nav_ident, display_name, nav_email, slack_member_id, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (nav_ident) DO UPDATE SET
       display_name    = EXCLUDED.display_name,
       nav_email       = EXCLUDED.nav_email,
       slack_member_id = COALESCE(EXCLUDED.slack_member_id, users.slack_member_id),
       updated_at      = NOW(),
       deleted_at      = NULL,
       deleted_by      = NULL
     RETURNING *`,
    [navIdent, displayName, navEmail, slackMemberId],
  )

  return result.rows[0]
}

/**
 * Create or update a user and GitHub account link.
 *
 * `displayGithubUsername` preserves original casing for display:
 * - Pass a string to set/overwrite the display casing.
 * - Pass `null` to preserve the existing stored value (uses COALESCE in SQL).
 * - Omit to derive from `githubUsername` (uses original casing of that input).
 */
export async function upsertUserAndGithubAccount(params: {
  githubUsername: string
  displayGithubUsername?: string | null
  displayName?: string | null
  navEmail?: string | null
  navIdent?: string | null
  slackMemberId?: string | null
}): Promise<void> {
  const githubUsername = normalize(params.githubUsername)?.toLowerCase() ?? null
  if (!githubUsername) {
    throw new Error('GitHub username is required')
  }

  const displayGithubUsername =
    params.displayGithubUsername !== undefined
      ? (normalize(params.displayGithubUsername) ?? null)
      : (normalize(params.githubUsername) ?? null)

  if (displayGithubUsername && displayGithubUsername.toLowerCase() !== githubUsername) {
    throw new Error(
      `display_github_username '${displayGithubUsername}' does not match github_username '${githubUsername}'`,
    )
  }

  const navIdent = normalizeNavIdent(params.navIdent)
  const displayName = normalize(params.displayName)
  const navEmail = normalizeEmail(params.navEmail)
  const slackMemberId = normalize(params.slackMemberId)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (navIdent && displayName && navEmail) {
      await client.query(
        `INSERT INTO users (nav_ident, display_name, nav_email, slack_member_id, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (nav_ident) DO UPDATE SET
           display_name    = EXCLUDED.display_name,
           nav_email       = EXCLUDED.nav_email,
           slack_member_id = COALESCE(EXCLUDED.slack_member_id, users.slack_member_id),
           updated_at      = NOW(),
           deleted_at      = NULL,
           deleted_by      = NULL`,
        [navIdent, displayName, navEmail, slackMemberId],
      )
      await client.query(
        `INSERT INTO user_github_accounts (github_username, display_github_username, nav_ident, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (github_username) DO UPDATE SET
           display_github_username = COALESCE(EXCLUDED.display_github_username, user_github_accounts.display_github_username),
           nav_ident               = EXCLUDED.nav_ident,
           updated_at              = NOW(),
           deleted_at              = NULL,
           deleted_by              = NULL`,
        [githubUsername, displayGithubUsername, navIdent],
      )
    } else if (navIdent) {
      const { rows } = await client.query<{ nav_ident: string }>(
        'SELECT nav_ident FROM users WHERE nav_ident = $1 AND deleted_at IS NULL',
        [navIdent],
      )
      if (rows.length > 0) {
        await client.query(
          `INSERT INTO user_github_accounts (github_username, display_github_username, nav_ident, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (github_username) DO UPDATE SET
             display_github_username = COALESCE(EXCLUDED.display_github_username, user_github_accounts.display_github_username),
             nav_ident               = EXCLUDED.nav_ident,
             updated_at              = NOW(),
             deleted_at              = NULL,
             deleted_by              = NULL`,
          [githubUsername, displayGithubUsername, navIdent],
        )
      } else {
        logger.warn('upsertUserAndGithubAccount: user row not found, skipping account link', {
          githubUsername,
          navIdent,
        })
      }
    } else {
      logger.warn('upsertUserAndGithubAccount called without navIdent — no GitHub account link created', {
        githubUsername,
      })
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

interface PopulateResult {
  success: number
  skipped: number
  errors: number
}

/**
 * Refresh the `users` table from the MS Graph API.
 *
 * For every active `users` row that has a nav_ident, looks up the user
 * in Graph and upserts the latest display_name, nav_email, and slack_member_id.
 * Idempotent — safe to run multiple times.
 */
export async function populateUsersFromGraph(): Promise<PopulateResult> {
  const { rows } = await pool.query<{ nav_ident: string }>(
    `SELECT DISTINCT nav_ident FROM users WHERE deleted_at IS NULL`,
  )

  let success = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    const navIdent = normalizeNavIdent(row.nav_ident)
    if (!navIdent) {
      skipped++
      continue
    }
    try {
      const graphUsers = await searchGraphUsers(navIdent)
      if (graphUsers.length !== 1) {
        logger.warn('populate-users: skipping nav_ident — expected 1 Graph result', {
          nav_ident: navIdent,
          count: graphUsers.length,
        })
        skipped++
        continue
      }
      const user = graphUsers[0]
      if (!user.displayName || !user.email) {
        logger.warn('populate-users: skipping nav_ident — missing displayName or email', { nav_ident: navIdent })
        skipped++
        continue
      }
      await upsertUser({ navIdent, displayName: user.displayName, navEmail: user.email })
      success++
    } catch (err) {
      logger.error('populate-users: error processing nav_ident', err)
      errors++
    }
  }

  return { success, skipped, errors }
}

/**
 * Get active users from the `users` table that have no linked GitHub account
 * in `user_github_accounts`. These are users added without a GitHub account
 * (e.g. produktledere).
 */
export async function getUsersWithoutGithub(): Promise<
  { nav_ident: string; display_name: string; nav_email: string }[]
> {
  const result = await pool.query<{ nav_ident: string; display_name: string; nav_email: string }>(
    `SELECT u.nav_ident, u.display_name, u.nav_email
     FROM users u
     WHERE u.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM user_github_accounts uga
         WHERE uga.nav_ident = u.nav_ident AND uga.deleted_at IS NULL
       )
     ORDER BY u.display_name`,
  )
  return result.rows
}

/**
 * Get a user from the `users` table by NAV-ident — excludes soft-deleted.
 */
export async function getUserByNavIdent(navIdent: string): Promise<User | null> {
  const result = await pool.query<User>('SELECT * FROM users WHERE nav_ident = UPPER($1) AND deleted_at IS NULL', [
    navIdent,
  ])
  return result.rows[0] ?? null
}
