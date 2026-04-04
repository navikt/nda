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
 */
export async function seedApp(
  pool: Pool,
  opts: { teamSlug: string; appName: string; environment: string },
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO monitored_applications (team_slug, app_name, environment_name, is_active)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [opts.teamSlug, opts.appName, opts.environment],
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
  },
): Promise<number> {
  const naisId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO deployments (
      monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
      commit_sha, created_at, title, four_eyes_status,
      detected_github_owner, detected_github_repo_name
    ) VALUES ($1, $2, $3, 'test-app', $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      opts.monitoredAppId,
      naisId,
      opts.teamSlug,
      opts.environment,
      opts.commitSha ?? `abc${Date.now()}`,
      opts.createdAt ?? new Date(),
      opts.title ?? null,
      opts.fourEyesStatus ?? 'pending',
      opts.githubOwner ?? null,
      opts.githubRepo ?? null,
    ],
  )
  return rows[0].id
}
