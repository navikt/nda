import { isGitHubBot } from '~/lib/github-bots'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'

export interface UserMapping {
  github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
  deleted_by: string | null
}

// In-memory cache for user mappings
const userMappingCache = new Map<string, UserMapping | null>()

/**
 * Clear the in-memory user mapping cache. Intended for tests; safe to call
 * in production but will cause a brief spike of DB hits as caches refill.
 */
export function clearUserMappingCache(): void {
  userMappingCache.clear()
}

/**
 * Get user mapping by GitHub username or NAV-ident.
 *
 * Returns soft-deleted mappings too, so historical deployments keep resolving
 * to the previously-mapped display name.
 */
export async function getUserMapping(identifier: string): Promise<UserMapping | null> {
  const key = identifier.toLowerCase()

  // Check cache first
  if (userMappingCache.has(key)) {
    return userMappingCache.get(key) || null
  }

  // Search both github_username and nav_ident
  const result = await pool.query(
    `SELECT * FROM user_mappings 
     WHERE github_username = $1 OR nav_ident = UPPER($1)`,
    [identifier],
  )

  const mapping = result.rows[0] || null

  // Cache by both github_username and nav_ident
  if (mapping) {
    userMappingCache.set(mapping.github_username.toLowerCase(), mapping)
    if (mapping.nav_ident) {
      userMappingCache.set(mapping.nav_ident.toLowerCase(), mapping)
    }
  } else {
    userMappingCache.set(key, null)
  }

  return mapping
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

  // Filter out cached entries (check both github_username and nav_ident keys)
  const uncached = identifiers.filter((u) => !userMappingCache.has(u.toLowerCase()))

  if (uncached.length > 0) {
    // Search both github_username and nav_ident
    const result = await pool.query(
      `SELECT * FROM user_mappings 
       WHERE github_username = ANY($1) 
          OR nav_ident = ANY($2)`,
      [uncached, uncached.map((u) => u.toUpperCase())],
    )

    // Cache results by both github_username and nav_ident
    for (const row of result.rows) {
      userMappingCache.set(row.github_username.toLowerCase(), row)
      if (row.nav_ident) {
        userMappingCache.set(row.nav_ident.toLowerCase(), row)
      }
    }

    // Mark missing identifiers as null in cache
    for (const identifier of uncached) {
      if (!userMappingCache.has(identifier.toLowerCase())) {
        userMappingCache.set(identifier.toLowerCase(), null)
      }
    }
  }

  // Build result map from cache
  const mappings = new Map<string, UserMapping>()
  for (const identifier of identifiers) {
    const mapping = userMappingCache.get(identifier.toLowerCase())
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
 * Create or update a user mapping
 */
export async function upsertUserMapping(params: {
  githubUsername: string
  displayName?: string | null
  navEmail?: string | null
  navIdent?: string | null
  slackMemberId?: string | null
}): Promise<UserMapping> {
  const githubUsername = normalize(params.githubUsername)
  if (!githubUsername) {
    throw new Error('GitHub username is required')
  }

  const result = await pool.query(
    `INSERT INTO user_mappings (github_username, display_name, nav_email, nav_ident, slack_member_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (github_username) DO UPDATE SET
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
      normalize(params.displayName),
      normalizeEmail(params.navEmail),
      normalizeNavIdent(params.navIdent),
      normalize(params.slackMemberId),
    ],
  )

  const mapping = result.rows[0]
  userMappingCache.set(githubUsername.toLowerCase(), mapping)
  if (mapping.nav_ident) {
    userMappingCache.set(mapping.nav_ident.toLowerCase(), mapping)
  }
  return mapping
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
  // Fetch from DB to reliably get nav_ident for cache cleanup
  const result = await pool.query('SELECT nav_ident FROM user_mappings WHERE github_username = $1', [githubUsername])
  const existing = result.rows[0]
  await pool.query(
    'UPDATE user_mappings SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW() WHERE github_username = $1 AND deleted_at IS NULL',
    [githubUsername, deletedBy],
  )
  // Drop cached entries so the next cached "current state" lookup by GitHub
  // username or nav-ident re-queries and respects the deleted_at filter.
  // Display-name lookups will repopulate the cache from the soft-deleted row.
  // Cache keys are lowercased; DB matching is case-sensitive (pre-existing).
  userMappingCache.delete(githubUsername.toLowerCase())
  if (existing?.nav_ident) {
    userMappingCache.delete(existing.nav_ident.toLowerCase())
  }
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
      ON d.deployer_username = um.github_username AND um.deleted_at IS NULL
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
