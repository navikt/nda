/**
 * Shared test helpers for integration tests.
 */
import type { Pool } from 'pg'

/**
 * Truncate all application tables (preserving pgmigrations).
 * Uses RESTART IDENTITY to reset serial counters.
 */
export async function truncateAllTables(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != 'pgmigrations'
    ORDER BY tablename
  `)
  if (rows.length === 0) return

  const tableList = rows.map((r) => `"${r.tablename}"`).join(', ')
  await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`)
}

/**
 * Insert a section and return its id.
 */
export async function seedSection(pool: Pool, slug: string, name?: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(`INSERT INTO sections (slug, name) VALUES ($1, $2) RETURNING id`, [
    slug,
    name ?? slug,
  ])
  return rows[0].id
}

/**
 * Insert a monitored application and return its id.
 *
 * When `auditStartYear` is omitted, defaults to the current year
 * (matches production behavior). Pass `null` explicitly to opt out
 * of any audit window; pass a number to override.
 */
export async function seedApp(
  pool: Pool,
  opts: { teamSlug: string; appName: string; environment: string; auditStartYear?: number | null },
): Promise<number> {
  const year = opts.auditStartYear === undefined ? new Date().getFullYear() : opts.auditStartYear
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO monitored_applications (team_slug, app_name, environment_name, is_active, audit_start_year, default_branch)
     VALUES ($1, $2, $3, true, $4, 'main') RETURNING id`,
    [opts.teamSlug, opts.appName, opts.environment, year],
  )
  return rows[0].id
}

/**
 * Insert a dev team and return its id.
 */
export async function seedDevTeam(pool: Pool, slug: string, name?: string, sectionId?: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO dev_teams (slug, name, section_id) VALUES ($1, $2, $3) RETURNING id`,
    [slug, name ?? slug, sectionId ?? null],
  )
  return rows[0].id
}

/**
 * Insert a user into the users table (required before calling assignTeamRole/assignSectionRole).
 * Uses ON CONFLICT DO NOTHING so it is safe to call multiple times with the same nav_ident.
 */
export async function seedUser(pool: Pool, navIdent: string, displayName?: string): Promise<void> {
  await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ($1, $2) ON CONFLICT (nav_ident) DO NOTHING`, [
    navIdent.toUpperCase(),
    displayName ?? null,
  ])
}

/**
 * Insert a deployment and return its id.
 */
export async function seedDeployment(
  pool: Pool,
  opts: {
    monitoredAppId: number
    teamSlug: string
    environment: string
    commitSha?: string
    createdAt?: Date
    title?: string
    fourEyesStatus?: string
    githubOwner?: string
    githubRepo?: string
    deployerUsername?: string | null
    githubPrData?: Record<string, unknown> | null
    appName?: string
  },
): Promise<number> {
  const naisId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO deployments (
      monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
      commit_sha, created_at, title, four_eyes_status,
      detected_github_owner, detected_github_repo_name,
      deployer_username, github_pr_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id`,
    [
      opts.monitoredAppId,
      naisId,
      opts.teamSlug,
      opts.appName ?? 'test-app',
      opts.environment,
      opts.commitSha ?? `abc${Date.now()}`,
      opts.createdAt ?? new Date(),
      opts.title ?? null,
      opts.fourEyesStatus ?? 'pending',
      opts.githubOwner ?? null,
      opts.githubRepo ?? null,
      opts.deployerUsername ?? null,
      opts.githubPrData ? JSON.stringify(opts.githubPrData) : null,
    ],
  )
  return rows[0].id
}

/**
 * Create an application group and return its id.
 */
export async function seedApplicationGroup(pool: Pool, name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(`INSERT INTO application_groups (name) VALUES ($1) RETURNING id`, [
    name,
  ])
  return rows[0].id
}

/**
 * Assign a monitored application to an application group.
 */
export async function assignAppToGroup(pool: Pool, appId: number, groupId: number): Promise<void> {
  await pool.query(`UPDATE monitored_applications SET application_group_id = $1 WHERE id = $2`, [groupId, appId])
}
