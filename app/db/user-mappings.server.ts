import { isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'

/** @public — returned by legacy read functions; remove in step 5e when user_mappings is dropped */
export interface UserMapping {
  github_username: string
  display_github_username: string | null
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  deleted_by: string | null
}

/**
 * Get user mapping by GitHub username or NAV-ident.
 *
 * Returns soft-deleted mappings too, so historical deployment lookups can still
 * find the mapping. Note: display_name and nav_email are read from the `users`
 * table and may be null if the user has not been imported yet.
 */
export async function getUserMapping(identifier: string): Promise<UserMapping | null> {
  const result = await pool.query(
    `SELECT um.github_username,
            um.display_github_username,
            um.nav_ident,
            um.slack_member_id,
            um.created_at,
            um.updated_at,
            um.deleted_at,
            um.deleted_by,
            u.display_name,
            u.nav_email
     FROM user_mappings um
     LEFT JOIN users u ON u.nav_ident = um.nav_ident AND u.deleted_at IS NULL
     WHERE um.github_username = LOWER($1) OR um.nav_ident = UPPER($1)`,
    [identifier],
  )
  return result.rows[0] || null
}

/**
 * Get multiple user mappings by GitHub usernames or NAV-idents.
 * Searches both github_username and nav_ident fields.
 *
 * Returns soft-deleted mappings too, so historical deployment lookups can still
 * find the mapping. Note: display_name and nav_email are read from the `users`
 * table and may be null if the user has not been imported yet.
 */
export async function getUserMappings(identifiers: string[]): Promise<Map<string, UserMapping>> {
  if (identifiers.length === 0) return new Map()

  const result = await pool.query(
    `SELECT um.github_username,
            um.display_github_username,
            um.nav_ident,
            um.slack_member_id,
            um.created_at,
            um.updated_at,
            um.deleted_at,
            um.deleted_by,
            u.display_name,
            u.nav_email
     FROM user_mappings um
     LEFT JOIN users u ON u.nav_ident = um.nav_ident AND u.deleted_at IS NULL
     WHERE um.github_username = ANY($1)
        OR um.nav_ident = ANY($2)`,
    [identifiers.map((u) => u.toLowerCase()), identifiers.map((u) => u.toUpperCase())],
  )

  // Build lookup maps keyed by lowercased github_username and nav_ident
  const byUsername = new Map<string, UserMapping>()
  const byNavIdent = new Map<string, UserMapping>()
  for (const row of result.rows) {
    byUsername.set(row.github_username.toLowerCase(), row)
    if (row.nav_ident) {
      byNavIdent.set(row.nav_ident.toLowerCase(), row)
    }
  }

  // Single pass over identifiers to build result map
  const mappings = new Map<string, UserMapping>()
  for (const identifier of identifiers) {
    const key = identifier.toLowerCase()
    const mapping = byUsername.get(key) ?? byNavIdent.get(key)
    if (mapping) {
      mappings.set(identifier, mapping)
    }
  }

  return mappings
}

/**
 * Normalize a string value - trim whitespace, return null if empty
 */
function normalize(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Normalize a NAV-ident - trim, uppercase, return null if empty.
 * NAV-idents are stored uppercase so that plain equality can be used
 * in JOIN conditions (dev_team_role_assignments already stores them uppercase).
 */
function normalizeNavIdent(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toUpperCase()
  return trimmed || null
}

/**
 * Normalize an email - trim, lowercase, return null if empty
 */
function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed || null
}

/**
 * Create or update a user mapping.
 * `displayGithubUsername` preserves original casing for display:
 * - Pass a string to set/overwrite the display casing.
 * - Pass `null` to preserve the existing stored value (uses COALESCE in SQL).
 * - Omit to derive from `githubUsername` (uses original casing of that input).
 */
export async function upsertUserMapping(params: {
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
  // Use explicit display username if provided, otherwise fall back to the
  // original-cased input (before lowercasing). On UPDATE, COALESCE ensures we
  // keep the existing value when NULL is passed.
  const displayGithubUsername =
    params.displayGithubUsername !== undefined
      ? (normalize(params.displayGithubUsername) ?? null)
      : (normalize(params.githubUsername) ?? null)

  // Invariant: display casing must match the canonical username case-insensitively
  if (displayGithubUsername && displayGithubUsername.toLowerCase() !== githubUsername) {
    throw new Error(
      `display_github_username '${displayGithubUsername}' does not match github_username '${githubUsername}'`,
    )
  }

  const navIdent = normalizeNavIdent(params.navIdent)
  const displayName = normalize(params.displayName)
  const navEmail = normalizeEmail(params.navEmail)
  const slackMemberId = normalize(params.slackMemberId)

  // Wrap all writes in a single transaction to prevent partial failures: if any
  // write throws, all changes are rolled back together. Note that the primary
  // tables (users + user_github_accounts) are only written when the required
  // fields are present (navIdent + displayName + navEmail), so the transaction
  // does not guarantee both tables always receive identical data — just that
  // whichever writes do execute either all succeed or all roll back.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Dual-write: user_mappings is the legacy table kept for backward compat until step 5e.
    // Production routes read from users/user_github_accounts only (step 5d), but legacy
    // integration tests and read functions still depend on user_mappings being in sync.
    await client.query(
      `INSERT INTO user_mappings (github_username, display_github_username, display_name, nav_email, nav_ident, slack_member_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (github_username) DO UPDATE SET
         display_github_username = COALESCE(EXCLUDED.display_github_username, user_mappings.display_github_username),
         display_name = COALESCE(EXCLUDED.display_name, user_mappings.display_name),
         nav_email = COALESCE(EXCLUDED.nav_email, user_mappings.nav_email),
         nav_ident = COALESCE(EXCLUDED.nav_ident, user_mappings.nav_ident),
         slack_member_id = COALESCE(EXCLUDED.slack_member_id, user_mappings.slack_member_id),
         updated_at = NOW(),
         deleted_at = NULL,
         deleted_by = NULL`,
      [githubUsername, displayGithubUsername, displayName, navEmail, navIdent, slackMemberId],
    )

    // Dual-write to users + user_github_accounts (primary going forward).
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
      // Have NAV-ident but missing Graph API fields — only link account if user row already exists.
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
        logger.warn('upsertUserMapping: user row not found, skipping account link', { githubUsername, navIdent })
      }
    } else {
      logger.warn('upsertUserMapping called without navIdent — no GitHub account link created', { githubUsername })
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
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
 * Called from upsertUserMapping (dual-write) and from the populate-users script.
 * Requires display_name and nav_email — Graph API lookup must happen before calling this.
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

  const result = await pool.query(
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
 * Soft-delete a user mapping.
 *
 * The row is preserved so historical deployments still resolve to the mapped
 * display name. Admin lists, current-user identity lookups, and "unmapped users"
 * suggestions treat the row as gone. `upsertUserMapping` will undelete on
 * conflict.
 */
export async function deleteUserMapping(githubUsername: string, deletedBy: string | null = null): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'UPDATE user_mappings SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW() WHERE github_username = LOWER($1) AND deleted_at IS NULL',
      [githubUsername.trim(), deletedBy],
    )
    await client.query(
      'UPDATE user_github_accounts SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW() WHERE github_username = LOWER($1) AND deleted_at IS NULL',
      [githubUsername.trim(), deletedBy],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Get all active (non-soft-deleted) user mappings — for admin list views.
 */
export async function getAllUserMappings(): Promise<UserMapping[]> {
  const result = await pool.query(
    `SELECT um.github_username,
            um.display_github_username,
            um.nav_ident,
            um.slack_member_id,
            um.created_at,
            um.updated_at,
            um.deleted_at,
            um.deleted_by,
            u.display_name,
            u.nav_email
     FROM user_mappings um
     LEFT JOIN users u ON u.nav_ident = um.nav_ident AND u.deleted_at IS NULL
     WHERE um.deleted_at IS NULL
     ORDER BY um.github_username`,
  )
  return result.rows
}

/**
 * Get GitHub usernames from deployments that don't have an active user mapping.
 * Soft-deleted mappings are treated as missing so admins can re-create them.
 * Excludes known bot accounts.
 *
 * Only counts deployments to actively monitored apps, respecting each app's
 * `audit_start_year` — deployments before the audit window are excluded.
 */
export async function getUnmappedUsers(): Promise<{ github_username: string; deployment_count: number }[]> {
  const result = await pool.query(`
    SELECT d.deployer_username as github_username, COUNT(*) as deployment_count
    FROM deployments d
    INNER JOIN monitored_applications ma
      ON d.monitored_app_id = ma.id AND ma.is_active = true
    LEFT JOIN user_mappings um
      ON LOWER(d.deployer_username) = um.github_username AND um.deleted_at IS NULL
    WHERE d.deployer_username IS NOT NULL
      AND d.deployer_username != ''
      AND um.github_username IS NULL
      AND ${AUDIT_START_YEAR_FILTER}
    GROUP BY d.deployer_username
    ORDER BY github_username
  `)

  // Filter out bot accounts
  return result.rows
    .filter((r) => !isGitHubBot(r.github_username))
    .map((r) => ({
      github_username: r.github_username,
      deployment_count: parseInt(r.deployment_count, 10),
    }))
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
 * Get user mapping by NAV-ident — current-state lookup, excludes soft-deleted.
 */
export async function getUserMappingByNavIdent(navIdent: string): Promise<UserMapping | null> {
  const result = await pool.query('SELECT * FROM user_mappings WHERE nav_ident = UPPER($1) AND deleted_at IS NULL', [
    navIdent,
  ])
  return result.rows[0] || null
}

/**
 * Get a user from the `users` table by NAV-ident — excludes soft-deleted.
 * Use this instead of getUserMappingByNavIdent when GitHub account is not required.
 */
export async function getUserByNavIdent(navIdent: string): Promise<User | null> {
  const result = await pool.query<User>('SELECT * FROM users WHERE nav_ident = UPPER($1) AND deleted_at IS NULL', [
    navIdent,
  ])
  return result.rows[0] ?? null
}

/**
 * Get user mapping by Slack member ID — current-state lookup, excludes soft-deleted.
 */
export async function getUserMappingBySlackId(slackMemberId: string): Promise<UserMapping | null> {
  const result = await pool.query('SELECT * FROM user_mappings WHERE slack_member_id = $1 AND deleted_at IS NULL', [
    slackMemberId,
  ])
  return result.rows[0] || null
}
