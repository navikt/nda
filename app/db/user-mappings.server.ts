import { isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'

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
 * Returns soft-deleted mappings too, so historical deployments keep resolving
 * to the previously-mapped display name.
 */
export async function getUserMapping(identifier: string): Promise<UserMapping | null> {
  const result = await pool.query(
    `SELECT * FROM user_mappings 
     WHERE github_username = LOWER($1) OR nav_ident = UPPER($1)`,
    [identifier],
  )
  return result.rows[0] || null
}

/**
 * Get multiple user mappings by GitHub usernames or NAV-idents.
 * Searches both github_username and nav_ident fields.
 *
 * Returns soft-deleted mappings too, so historical deployments keep resolving
 * to the previously-mapped display name.
 */
export async function getUserMappings(identifiers: string[]): Promise<Map<string, UserMapping>> {
  if (identifiers.length === 0) return new Map()

  const result = await pool.query(
    `SELECT * FROM user_mappings 
     WHERE github_username = ANY($1) 
        OR nav_ident = ANY($2)`,
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
}): Promise<UserMapping> {
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

  const result = await pool.query(
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
       deleted_by = NULL
     RETURNING *`,
    [
      githubUsername,
      displayGithubUsername,
      normalize(params.displayName),
      normalizeEmail(params.navEmail),
      normalizeNavIdent(params.navIdent),
      normalize(params.slackMemberId),
    ],
  )

  const mapping: UserMapping = result.rows[0]

  // Dual-write: keep users table in sync when we have all required fields.
  // This ensures users are available for Step 2 (reading from users only).
  // Best-effort: a failure here must not break the existing user_mappings write.
  if (mapping.nav_ident && mapping.display_name && mapping.nav_email) {
    upsertUser({
      navIdent: mapping.nav_ident,
      displayName: mapping.display_name,
      navEmail: mapping.nav_email,
      slackMemberId: mapping.slack_member_id,
    }).catch((err) => {
      logger.error('Failed to dual-write to users table', err)
    })
  }

  return mapping
}

export interface User {
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

export interface PopulateResult {
  success: number
  skipped: number
  errors: number
}

/**
 * Backfill the `users` table from `user_mappings` + MS Graph API.
 *
 * For every active user_mappings row that has a nav_ident, looks up the user
 * in Graph and upserts into `users`. Idempotent — safe to run multiple times.
 */
export async function populateUsersFromGraph(): Promise<PopulateResult> {
  const { rows } = await pool.query<{ nav_ident: string }>(
    `SELECT DISTINCT nav_ident FROM user_mappings WHERE nav_ident IS NOT NULL AND deleted_at IS NULL`,
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
  await pool.query(
    'UPDATE user_mappings SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW() WHERE github_username = LOWER($1) AND deleted_at IS NULL',
    [githubUsername.trim(), deletedBy],
  )
}

/**
 * Get all active (non-soft-deleted) user mappings — for admin list views.
 */
export async function getAllUserMappings(): Promise<UserMapping[]> {
  const result = await pool.query('SELECT * FROM user_mappings WHERE deleted_at IS NULL ORDER BY github_username')
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
 * Get user mapping by NAV-ident — current-state lookup, excludes soft-deleted.
 */
export async function getUserMappingByNavIdent(navIdent: string): Promise<UserMapping | null> {
  const result = await pool.query('SELECT * FROM user_mappings WHERE nav_ident = UPPER($1) AND deleted_at IS NULL', [
    navIdent,
  ])
  return result.rows[0] || null
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
