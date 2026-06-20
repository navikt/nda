import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { runner } from 'node-pg-migrate'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seedApp } from './helpers'

const ORPHAN_MIGRATION_NAME = '1772700000000_populate-missing-github-pr-urls'
const NEW_MIGRATION_NAME = '1772800000000_backfill-github-pr-url-from-pr-number'

const EXCLUDE_FROM_BASELINE_PREFIX = 1772700000000n

const realMigrationsDir = join(process.cwd(), 'app/db/migrations')

let container: StartedPostgreSqlContainer
let pool: Pool
let databaseUrl: string
let tmpMigrationsDir: string

describe('Migration runs cleanly against orphan pgmigrations row (prod scenario)', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
    databaseUrl = container.getConnectionUri()
    pool = new Pool({ connectionString: databaseUrl })

    tmpMigrationsDir = join(tmpdir(), `nda-migrations-${Date.now()}`)
    mkdirSync(tmpMigrationsDir, { recursive: true })
    for (const file of readdirSync(realMigrationsDir)) {
      const tsMatch = file.match(/^(\d+)_/)
      const ts = tsMatch ? BigInt(tsMatch[1]) : null
      if (ts !== null && ts >= EXCLUDE_FROM_BASELINE_PREFIX) continue
      copyFileSync(join(realMigrationsDir, file), join(tmpMigrationsDir, file))
    }

    await runner({
      databaseUrl,
      dir: tmpMigrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      schema: 'public',
      log: () => {},
    })

    await pool.query(`INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())`, [ORPHAN_MIGRATION_NAME])
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
    await container?.stop()
    if (tmpMigrationsDir) rmSync(tmpMigrationsDir, { recursive: true, force: true })
  })

  test('reproduces prod state: orphan registered, new migration not run', async () => {
    const orphan = await pool.query(`SELECT name FROM pgmigrations WHERE name = $1`, [ORPHAN_MIGRATION_NAME])
    expect(orphan.rows).toHaveLength(1)

    const newOne = await pool.query(`SELECT name FROM pgmigrations WHERE name = $1`, [NEW_MIGRATION_NAME])
    expect(newOne.rows).toHaveLength(0)
  })

  test('node-pg-migrate runs new migration cleanly despite orphan', async () => {
    const appId = await seedApp(pool, { teamSlug: 't', appName: 'a', environment: 'prod-gcp' })

    await pool.query(
      `INSERT INTO deployments (
        nais_deployment_id, monitored_app_id, team_slug, app_name, environment_name,
        commit_sha, detected_github_owner, detected_github_repo_name,
        github_pr_number, github_pr_url, four_eyes_status, created_at
      ) VALUES ('nais-1', $1, 't', 'a', 'prod-gcp',
        'abc1234567890123456789012345678901234567', 'navikt', 'my-repo',
        13631, NULL, 'approved', NOW())`,
      [appId],
    )

    await pool.query(
      `INSERT INTO deployments (
        nais_deployment_id, monitored_app_id, team_slug, app_name, environment_name,
        commit_sha, detected_github_owner, detected_github_repo_name,
        github_pr_number, github_pr_url, four_eyes_status, created_at
      ) VALUES ('nais-2', $1, 't', 'a', 'prod-gcp',
        'def1234567890123456789012345678901234567', 'navikt', 'my-repo',
        99, 'https://github.com/navikt/my-repo/pull/99', 'approved', NOW())`,
      [appId],
    )

    for (const file of readdirSync(realMigrationsDir)) {
      const tsMatch = file.match(/^(\d+)_/)
      const ts = tsMatch ? BigInt(tsMatch[1]) : null
      if (ts === null || ts < EXCLUDE_FROM_BASELINE_PREFIX) continue
      copyFileSync(join(realMigrationsDir, file), join(tmpMigrationsDir, file))
    }

    await expect(
      runner({
        databaseUrl,
        dir: tmpMigrationsDir,
        direction: 'up',
        migrationsTable: 'pgmigrations',
        schema: 'public',
        log: () => {},
      }),
    ).resolves.not.toThrow()

    const registered = await pool.query(`SELECT name FROM pgmigrations WHERE name = $1`, [NEW_MIGRATION_NAME])
    expect(registered.rows).toHaveLength(1)

    const backfilled = await pool.query(`SELECT github_pr_url FROM deployments WHERE nais_deployment_id = 'nais-1'`)
    expect(backfilled.rows[0].github_pr_url).toBe('https://github.com/navikt/my-repo/pull/13631')

    const preserved = await pool.query(`SELECT github_pr_url FROM deployments WHERE nais_deployment_id = 'nais-2'`)
    expect(preserved.rows[0].github_pr_url).toBe('https://github.com/navikt/my-repo/pull/99')
  }, 60_000)

  test('re-running migrations is idempotent', async () => {
    await expect(
      runner({
        databaseUrl,
        dir: tmpMigrationsDir,
        direction: 'up',
        migrationsTable: 'pgmigrations',
        schema: 'public',
        log: () => {},
      }),
    ).resolves.not.toThrow()

    const rows = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pgmigrations WHERE name = $1`,
      [NEW_MIGRATION_NAME],
    )
    expect(rows.rows[0].count).toBe('1')
  }, 60_000)
})
