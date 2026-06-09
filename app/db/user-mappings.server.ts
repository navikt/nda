import { isGitHubBot } from '~/lib/github-bots'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'

/**
 * A user in the system identified by nav_ident.
 * github_username is null for users without a GitHub account (e.g. produktledere).
 *
 * Queries use a direct JOIN between users and user_github_accounts.
 * github_username may be null when the user has no linked GitHub account.
 */
export interface UserMapping {
  github_username: string | null
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
 *
 * Queries the underlying tables directly (not the VIEW) so that users without
 * a GitHub account are also found when looked up by nav_ident.
 */
export async function getUserMapping(identifier: string): Promise<UserMapping | null> {
  const result = await pool.query<UserMapping>(
    `-- NAV-ident match (branch 1) is preferred over github_username match (branch 2).
     -- The _priority column is stripped by the outer SELECT.
     SELECT github_username, display_github_username, display_name, nav_email, nav_ident,
            slack_member_id, created_at, updated_at, deleted_at, deleted_by
     FROM (
       -- Branch 1: Nav-ident lookup — finds users even without a GitHub account.
       -- Uses LATERAL to pick the most relevant github account: active primary first,
       -- then soft-deleted primary (so historical audit state is preserved after deletion).
       SELECT
         uga.github_username,
         uga.display_github_username,
         COALESCE(u.display_name, uga.display_name) AS display_name,
         u.nav_email,
         u.nav_ident,
         u.slack_member_id,
         u.created_at,
         COALESCE(GREATEST(u.updated_at, uga.updated_at), u.updated_at, uga.updated_at) AS updated_at,
         COALESCE(GREATEST(uga.deleted_at, u.deleted_at), uga.deleted_at, u.deleted_at) AS deleted_at,
         COALESCE(uga.deleted_by, u.deleted_by)      AS deleted_by,
         1 AS _priority
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM user_github_accounts uga2
         WHERE uga2.nav_ident = u.nav_ident
         ORDER BY
           (uga2.deleted_at IS NULL)::int DESC,
           uga2.is_primary DESC,
           uga2.updated_at DESC NULLS LAST
         LIMIT 1
       ) uga ON TRUE
       WHERE u.nav_ident = UPPER($1)

       UNION ALL

       -- Branch 2: GitHub username lookup — finds accounts including unlinked deployers
       SELECT
         uga.github_username,
         uga.display_github_username,
         COALESCE(u.display_name, uga.display_name) AS display_name,
         u.nav_email,
         u.nav_ident,
         u.slack_member_id,
         uga.created_at,
         COALESCE(GREATEST(u.updated_at, uga.updated_at), u.updated_at, uga.updated_at) AS updated_at,
         COALESCE(GREATEST(uga.deleted_at, u.deleted_at), uga.deleted_at, u.deleted_at) AS deleted_at,
         COALESCE(uga.deleted_by, u.deleted_by)      AS deleted_by,
         2 AS _priority
       FROM user_github_accounts uga
       LEFT JOIN users u ON u.nav_ident = uga.nav_ident
       WHERE uga.github_username = LOWER($1)
     ) combined
     ORDER BY _priority
     LIMIT 1`,
    [identifier],
  )
  return result.rows[0] ?? null
}

/**
 * Get multiple user mappings by GitHub usernames or NAV-idents.
 * Searches both github_username and nav_ident fields.
 *
 * Returns soft-deleted mappings too, so historical deployments keep resolving
 * to the previously-mapped display name.
 *
 * Includes users without a GitHub account (e.g. produktledere) when looked up
 * by nav_ident.
 */
export async function getUserMappings(identifiers: string[]): Promise<Map<string, UserMapping>> {
  if (identifiers.length === 0) return new Map()

  const lowerIdents = identifiers.map((u) => u.toLowerCase())
  const upperIdents = identifiers.map((u) => u.toUpperCase())

  const result = await pool.query<UserMapping>(
    `    -- Branch 1: Look up by github_username via direct table join (replaces VIEW query).
    SELECT
      uga.github_username, uga.display_github_username,
      COALESCE(u.display_name, uga.display_name) AS display_name,
      u.nav_email, u.nav_ident, u.slack_member_id, uga.created_at,
      COALESCE(GREATEST(u.updated_at, uga.updated_at), u.updated_at, uga.updated_at) AS updated_at,
      COALESCE(GREATEST(uga.deleted_at, u.deleted_at), uga.deleted_at, u.deleted_at) AS deleted_at,
      COALESCE(uga.deleted_by, u.deleted_by)      AS deleted_by
    FROM user_github_accounts uga
    LEFT JOIN users u ON u.nav_ident = uga.nav_ident
    WHERE uga.github_username = ANY($1)

     UNION ALL

     -- Branch 2: Look up by nav_ident — LATERAL selects best active GitHub account
     -- (primary preferred, else most-recently-updated active account).
     SELECT
       uga.github_username,
       uga.display_github_username,
       COALESCE(u.display_name, uga.display_name) AS display_name,
       u.nav_email,
       u.nav_ident,
       u.slack_member_id,
       u.created_at,
       COALESCE(GREATEST(u.updated_at, uga.updated_at), u.updated_at, uga.updated_at) AS updated_at,
       COALESCE(GREATEST(uga.deleted_at, u.deleted_at), uga.deleted_at, u.deleted_at) AS deleted_at,
       COALESCE(uga.deleted_by, u.deleted_by)      AS deleted_by
     FROM users u
     LEFT JOIN LATERAL (
       SELECT github_username, display_github_username, display_name, updated_at, deleted_at, deleted_by
       FROM user_github_accounts
       WHERE nav_ident = u.nav_ident AND deleted_at IS NULL
       ORDER BY is_primary DESC, updated_at DESC NULLS LAST
       LIMIT 1
     ) uga ON TRUE
     WHERE u.nav_ident = ANY($2)`,
    [lowerIdents, upperIdents],
  )

  // Build lookup maps keyed by lowercased github_username and nav_ident
  const byUsername = new Map<string, UserMapping>()
  const byNavIdent = new Map<string, UserMapping>()
  for (const row of result.rows) {
    if (row.github_username) {
      byUsername.set(row.github_username.toLowerCase(), row)
    }
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
 * Upsert a user identified only by NAV-ident — no GitHub account required.
 * Used for roles like produktleder who may not have a GitHub account.
 * If the user already exists, non-null fields are merged and deleted_at is cleared.
 */
export async function upsertUser(params: {
  navIdent: string
  displayName: string
  navEmail: string
  slackMemberId?: string | null
}): Promise<UserMapping> {
  const navIdent = normalizeNavIdent(params.navIdent)
  if (!navIdent) throw new Error('nav_ident is required')

  await pool.query(
    `INSERT INTO users (nav_ident, display_name, nav_email, slack_member_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (nav_ident) DO UPDATE SET
       display_name    = EXCLUDED.display_name,
       nav_email       = EXCLUDED.nav_email,
       slack_member_id = COALESCE(EXCLUDED.slack_member_id, users.slack_member_id),
       updated_at      = NOW(),
       deleted_at      = NULL,
       deleted_by      = NULL`,
    [navIdent, params.displayName, normalizeEmail(params.navEmail), normalize(params.slackMemberId)],
  )

  const result = await pool.query<UserMapping>(
    `SELECT
       NULL::text              AS github_username,
       NULL::text              AS display_github_username,
       u.display_name,
       u.nav_email,
       u.nav_ident,
       u.slack_member_id,
       u.created_at,
       u.updated_at,
       u.deleted_at,
       u.deleted_by
     FROM users u
     WHERE u.nav_ident = $1`,
    [navIdent],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`upsertUser: no row returned for nav_ident=${navIdent}`)
  return row
}

/**
 * Create or update a user mapping (user + GitHub account).
 * `displayGithubUsername` preserves original casing for display:
 * - Pass a string to set/overwrite the display casing.
 * - Pass `null` to preserve the existing stored value (uses COALESCE in SQL).
 * - Omit to derive from `githubUsername` (uses original casing of that input).
 *
 * Also upserts the linked user row (if navIdent is provided).
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

  if (navIdent && !displayName) {
    throw new Error(`upsertUserMapping: displayName is required when navIdent is provided (navIdent=${navIdent})`)
  }

  const navEmail = normalizeEmail(params.navEmail)

  if (navIdent && !navEmail) {
    throw new Error(`upsertUserMapping: navEmail is required when navIdent is provided (navIdent=${navIdent})`)
  }

  const slackMemberId = normalize(params.slackMemberId)

  // Both writes must succeed or both must roll back to prevent orphaned rows.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Upsert the user row first (if nav_ident is known)
    if (navIdent) {
      await client.query(
        `INSERT INTO users (nav_ident, display_name, nav_email, slack_member_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (nav_ident) DO UPDATE SET
           display_name    = EXCLUDED.display_name,
           nav_email       = EXCLUDED.nav_email,
           slack_member_id = COALESCE(EXCLUDED.slack_member_id, users.slack_member_id),
           updated_at      = NOW(),
           deleted_at      = NULL,
           deleted_by      = NULL`,
        [navIdent, displayName, navEmail, slackMemberId],
      )
    }

    // Upsert the GitHub account row.
    // Before inserting, demote any existing active primary for this nav_ident so
    // the UNIQUE INDEX (nav_ident WHERE is_primary=TRUE AND deleted_at IS NULL)
    // is not violated when a user gets a second GitHub account.
    if (navIdent) {
      await client.query(
        `UPDATE user_github_accounts
         SET is_primary = FALSE, updated_at = NOW()
         WHERE nav_ident = $1 AND is_primary = TRUE AND deleted_at IS NULL AND github_username != $2`,
        [navIdent, githubUsername],
      )
    }

    await client.query(
      `INSERT INTO user_github_accounts
         (github_username, display_github_username, nav_ident, display_name, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (github_username) DO UPDATE SET
         display_github_username = COALESCE(EXCLUDED.display_github_username, user_github_accounts.display_github_username),
         nav_ident               = COALESCE(EXCLUDED.nav_ident,               user_github_accounts.nav_ident),
         display_name            = COALESCE(EXCLUDED.display_name,            user_github_accounts.display_name),
         is_primary              = TRUE,
         updated_at              = NOW(),
         deleted_at              = NULL,
         deleted_by              = NULL`,
      [githubUsername, displayGithubUsername, navIdent, navIdent ? null : displayName],
    )

    // If displayName is provided but navIdent is not, propagate displayName to any
    // linked user row so the join's COALESCE(u.display_name, uga.display_name) reflects
    // the new value (u.display_name takes priority in the direct join).
    if (!navIdent && displayName) {
      await client.query(
        `UPDATE users
         SET display_name = $1, updated_at = NOW()
         FROM user_github_accounts uga
         WHERE uga.github_username = $2
           AND uga.nav_ident IS NOT NULL
           AND users.nav_ident = uga.nav_ident`,
        [displayName, githubUsername],
      )
    }

    const result = await client.query<UserMapping>(
      `SELECT
         uga.github_username, uga.display_github_username,
         COALESCE(u.display_name, uga.display_name) AS display_name,
         u.nav_email, u.nav_ident, u.slack_member_id, uga.created_at,
         COALESCE(GREATEST(u.updated_at, uga.updated_at), u.updated_at, uga.updated_at) AS updated_at,
         COALESCE(GREATEST(uga.deleted_at, u.deleted_at), uga.deleted_at, u.deleted_at) AS deleted_at,
         COALESCE(uga.deleted_by, u.deleted_by)      AS deleted_by
       FROM user_github_accounts uga
       LEFT JOIN users u ON u.nav_ident = uga.nav_ident
       WHERE uga.github_username = $1`,
      [githubUsername],
    )
    await client.query('COMMIT')
    const row = result.rows[0]
    if (!row) throw new Error(`upsertUserMapping: no row returned for github_username=${githubUsername}`)
    return row
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Soft-delete a user's GitHub account mapping.
 * The row is preserved so historical deployments still resolve to the mapped
 * display name. `upsertUserMapping` will undelete on conflict.
 */
export async function deleteUserMapping(githubUsername: string, deletedBy: string | null = null): Promise<void> {
  await pool.query(
    `UPDATE user_github_accounts
     SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
     WHERE github_username = LOWER($1) AND deleted_at IS NULL`,
    [githubUsername.trim(), deletedBy],
  )
}

/**
 * Soft-delete a user (by NAV-ident) and all their GitHub accounts and role assignments.
 *
 * Runs in a single transaction to ensure atomicity:
 * - Role assignments are revoked immediately so any active Entra session
 *   loses its roles on the next authorization check.
 * - If a user with the same nav_ident is later re-created via upsertUser(),
 *   their roles will NOT be silently re-activated (they remain soft-deleted).
 */
export async function deleteUser(navIdent: string, deletedBy: string | null = null): Promise<void> {
  const normalized = normalizeNavIdent(navIdent)
  if (!normalized) return

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Revoke all active role assignments immediately so authorization checks
    // that read from these tables stop granting access.
    await client.query(
      `UPDATE dev_team_role_assignments
       SET deleted_at = NOW(), deleted_by = $2
       WHERE nav_ident = $1 AND deleted_at IS NULL`,
      [normalized, deletedBy],
    )
    await client.query(
      `UPDATE section_role_assignments
       SET deleted_at = NOW(), deleted_by = $2
       WHERE nav_ident = $1 AND deleted_at IS NULL`,
      [normalized, deletedBy],
    )

    // Soft-delete all linked GitHub accounts
    await client.query(
      `UPDATE user_github_accounts
       SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE nav_ident = $1 AND deleted_at IS NULL`,
      [normalized, deletedBy],
    )

    // Soft-delete the user row itself
    await client.query(
      `UPDATE users
       SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE nav_ident = $1 AND deleted_at IS NULL`,
      [normalized, deletedBy],
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Get all active users for admin list views.
 * Includes users without a GitHub account (e.g. produktledere).
 * Sorted by nav_ident (nulls last for unlinked GitHub accounts).
 */
export async function getAllUserMappings(): Promise<UserMapping[]> {
  const result = await pool.query<UserMapping>(`
    -- Branch 1: Users with a nav_ident who have ≥1 active GitHub account.
    -- LATERAL picks the best active account (primary preferred, then most recently updated).
    -- This handles the case where the primary is soft-deleted but a non-primary is still active.
    SELECT
      uga.github_username, uga.display_github_username,
      COALESCE(u.display_name, uga.display_name) AS display_name,
      u.nav_email, u.nav_ident, u.slack_member_id, uga.created_at,
      COALESCE(GREATEST(u.updated_at, uga.updated_at), u.updated_at, uga.updated_at) AS updated_at,
      COALESCE(GREATEST(uga.deleted_at, u.deleted_at), uga.deleted_at, u.deleted_at) AS deleted_at,
      COALESCE(uga.deleted_by, u.deleted_by) AS deleted_by
    FROM users u
    CROSS JOIN LATERAL (
      SELECT * FROM user_github_accounts uga2
      WHERE uga2.nav_ident = u.nav_ident AND uga2.deleted_at IS NULL
      ORDER BY uga2.is_primary DESC, uga2.updated_at DESC NULLS LAST
      LIMIT 1
    ) uga
    WHERE u.deleted_at IS NULL

    UNION ALL

    -- Branch 2: Users with a nav_ident but NO active GitHub account (e.g. produktledere).
    SELECT
      NULL::text AS github_username,
      NULL::text AS display_github_username,
      u.display_name,
      u.nav_email,
      u.nav_ident,
      u.slack_member_id,
      u.created_at,
      u.updated_at,
      u.deleted_at,
      u.deleted_by
    FROM users u
    WHERE u.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_github_accounts uga
        WHERE uga.nav_ident = u.nav_ident AND uga.deleted_at IS NULL
      )

    UNION ALL

    -- Branch 3: Unlinked GitHub accounts (nav_ident IS NULL) — deployers not yet mapped to a user.
    SELECT
      uga.github_username, uga.display_github_username,
      uga.display_name,
      NULL::text AS nav_email,
      NULL::text AS nav_ident,
      NULL::text AS slack_member_id,
      uga.created_at,
      uga.updated_at,
      uga.deleted_at,
      uga.deleted_by
    FROM user_github_accounts uga
    WHERE uga.deleted_at IS NULL
      AND uga.nav_ident IS NULL

    ORDER BY nav_ident NULLS LAST, github_username NULLS LAST
  `)
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
    LEFT JOIN user_github_accounts uga
      ON LOWER(d.deployer_username) = uga.github_username AND uga.deleted_at IS NULL
    WHERE d.deployer_username IS NOT NULL
      AND d.deployer_username != ''
      AND uga.github_username IS NULL
      AND ${AUDIT_START_YEAR_FILTER}
    GROUP BY d.deployer_username
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
 * Get user by NAV-ident — current-state lookup, excludes soft-deleted.
 * Returns a UserMapping-compatible row even if the user has no GitHub account.
 */
export async function getUserMappingByNavIdent(navIdent: string): Promise<UserMapping | null> {
  const result = await pool.query<UserMapping>(
    `SELECT
       uga.github_username,
       uga.display_github_username,
       COALESCE(u.display_name, uga.display_name) AS display_name,
       u.nav_email,
       u.nav_ident,
       u.slack_member_id,
       u.created_at,
       u.updated_at,
       u.deleted_at,
       u.deleted_by
     FROM users u
     LEFT JOIN LATERAL (
       SELECT * FROM user_github_accounts uga2
       WHERE uga2.nav_ident = u.nav_ident AND uga2.deleted_at IS NULL
       ORDER BY uga2.is_primary DESC, uga2.updated_at DESC NULLS LAST
       LIMIT 1
     ) uga ON TRUE
     WHERE u.nav_ident = UPPER($1) AND u.deleted_at IS NULL`,
    [navIdent],
  )
  return result.rows[0] ?? null
}

/**
 * Get user mapping by Slack member ID — current-state lookup, excludes soft-deleted.
 */
export async function getUserMappingBySlackId(slackMemberId: string): Promise<UserMapping | null> {
  const result = await pool.query<UserMapping>(
    `SELECT
       uga.github_username,
       uga.display_github_username,
       COALESCE(u.display_name, uga.display_name) AS display_name,
       u.nav_email,
       u.nav_ident,
       u.slack_member_id,
       u.created_at,
       u.updated_at,
       u.deleted_at,
       u.deleted_by
     FROM users u
     LEFT JOIN LATERAL (
       SELECT * FROM user_github_accounts uga2
       WHERE uga2.nav_ident = u.nav_ident AND uga2.deleted_at IS NULL
       ORDER BY uga2.is_primary DESC, uga2.updated_at DESC NULLS LAST
       LIMIT 1
     ) uga ON TRUE
     WHERE u.slack_member_id = $1 AND u.deleted_at IS NULL`,
    [slackMemberId],
  )
  return result.rows[0] ?? null
}
