import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seedApp } from './helpers'

let pool: Pool

describe('Migration ordering with prod scenario', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
  })

  afterAll(async () => {
    await pool.end()
  })

  test('should handle migration ordering when old migration already ran', async () => {
    const oldMigrationResult = await pool.query(`SELECT * FROM pgmigrations WHERE name = $1`, [
      '1772700000000_populate-missing-github-pr-urls',
    ])

    console.log('Old migration status:', oldMigrationResult.rows.length > 0 ? 'RAN' : 'NOT RUN')

    const newMigrationResult = await pool.query(`SELECT * FROM pgmigrations WHERE name = $1`, [
      '1772700000001_backfill-github-pr-urls-from-pr-number',
    ])

    console.log('New migration status:', newMigrationResult.rows.length > 0 ? 'RAN' : 'NOT RUN')

    const appId = await seedApp(pool, { teamSlug: 'test-team', appName: 'test-app', environment: 'prod-gcp' })

    const { rows: insertRows } = await pool.query<{ id: number }>(
      `INSERT INTO deployments (
        nais_deployment_id, 
        monitored_app_id, 
        team_slug,
        app_name,
        environment_name,
        commit_sha, 
        detected_github_owner,
        detected_github_repo_name,
        github_pr_number,
        github_pr_url,
        four_eyes_status,
        github_pr_data,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
      RETURNING id`,
      [
        'test-migration-order-1',
        appId,
        'test-team',
        'test-app',
        'prod-gcp',
        'abc1234567890123456789012345678901234567',
        'navikt',
        'test-repo',
        123,
        null, // NULL because old migration failed
        'approved',
        JSON.stringify({ title: 'Test PR', body: 'Test body' }), // No 'url' field!
      ],
    )
    const deploymentId = insertRows[0].id

    const beforeResult = await pool.query(
      'SELECT github_pr_number, github_pr_url, github_pr_data FROM deployments WHERE id = $1',
      [deploymentId],
    )
    expect(beforeResult.rows[0].github_pr_number).toBe(123)
    expect(beforeResult.rows[0].github_pr_url).toBeNull()
    expect(beforeResult.rows[0].github_pr_data).toHaveProperty('title')
    expect(beforeResult.rows[0].github_pr_data).not.toHaveProperty('url')

    const updateResult = await pool.query(`
      UPDATE deployments
      SET github_pr_url = 'https://github.com/' || detected_github_owner || '/' || detected_github_repo_name || '/pull/' || github_pr_number::text
      WHERE github_pr_url IS NULL
        AND github_pr_number IS NOT NULL
        AND detected_github_owner IS NOT NULL
        AND detected_github_repo_name IS NOT NULL
    `)

    console.log('Updated rows:', updateResult.rowCount)

    const afterResult = await pool.query('SELECT github_pr_number, github_pr_url FROM deployments WHERE id = $1', [
      deploymentId,
    ])
    expect(afterResult.rows[0].github_pr_number).toBe(123)
    expect(afterResult.rows[0].github_pr_url).toBe('https://github.com/navikt/test-repo/pull/123')

    await pool.query('DELETE FROM deployments WHERE id = $1', [deploymentId])
  })
})
