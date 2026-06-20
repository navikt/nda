import { isValidNavIdent } from '~/lib/form-validators'
import { isGitHubBot } from '~/lib/github-bots'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'

interface GithubUserLookup {
  github_username: string
  display_github_username: string | null
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
  account_deleted_at: Date | null
}

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

interface UserRecord {
  github_username: string | null
  display_github_username: string | null
  nav_ident: string
  display_name: string | null
  nav_email: string | null
  slack_member_id: string | null
}

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

export async function getUserByNavIdent(navIdent: string): Promise<User | null> {
  const result = await pool.query<User>('SELECT * FROM users WHERE nav_ident = UPPER($1) AND deleted_at IS NULL', [
    navIdent,
  ])
  return result.rows[0] ?? null
}
