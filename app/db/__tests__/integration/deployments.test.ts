/**
 * Integration test: Deployment SQL queries.
 * Tests insert, query, and update operations on the deployments table.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

describe('deployment queries', () => {
  it('should insert and retrieve a deployment', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Add feature X',
    })

    const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Add feature X')
    expect(rows[0].team_slug).toBe('team-1')
    expect(rows[0].four_eyes_status).toBe('pending')
  })

  it('should enforce unique nais_deployment_id', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at)
       VALUES ($1, 'unique-id-123', 'team-1', 'my-app', 'prod', NOW())`,
      [appId],
    )

    await expect(
      pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at)
         VALUES ($1, 'unique-id-123', 'team-1', 'my-app', 'prod', NOW())`,
        [appId],
      ),
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('should update title with COALESCE (preserving existing value)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Original title',
    })

    // Update with new title
    await pool.query(`UPDATE deployments SET title = COALESCE($2, title) WHERE id = $1`, [depId, 'New title'])
    const { rows: r1 } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(r1[0].title).toBe('New title')

    // Update with null title (should preserve existing)
    await pool.query(`UPDATE deployments SET title = COALESCE($2, title) WHERE id = $1`, [depId, null])
    const { rows: r2 } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(r2[0].title).toBe('New title')
  })

  it('should filter deployments by date range and team', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-1', environment: 'prod' })

    const jan = new Date('2025-01-15T12:00:00Z')
    const feb = new Date('2025-02-15T12:00:00Z')
    const mar = new Date('2025-03-15T12:00:00Z')

    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: jan })
    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: feb })
    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: mar })

    const startDate = new Date('2025-02-01')
    const endDate = new Date('2025-03-01')

    const { rows } = await pool.query(
      `SELECT id FROM deployments
       WHERE team_slug = $1
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at`,
      ['team-a', startDate, endDate],
    )

    expect(rows).toHaveLength(1)
  })

  it('should count deployments using FILTER clause correctly', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'app-x', environment: 'prod' })

    // Insert various four_eyes_status values
    for (const status of ['approved_pr', 'approved_pr', 'direct_push', 'pending']) {
      const naisId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status, has_four_eyes)
         VALUES ($1, $2, 'team-x', 'app-x', 'prod', NOW(), $3, $4)`,
        [appId, naisId, status, status === 'approved_pr'],
      )
    }

    // This is the exact pattern from getSectionOverallStats that previously had the ::int FILTER bug
    const { rows } = await pool.query(`
      SELECT
        COUNT(id)::int AS total,
        COUNT(id) FILTER (WHERE has_four_eyes = true)::int AS with_four_eyes,
        COUNT(id) FILTER (WHERE four_eyes_status IN ('direct_push', 'unverified_commits'))::int AS without_four_eyes,
        COUNT(id) FILTER (WHERE four_eyes_status IN ('pending', 'pending_baseline', 'unknown'))::int AS pending
      FROM deployments
      WHERE team_slug = 'team-x'
    `)

    expect(rows[0].total).toBe(4)
    expect(rows[0].with_four_eyes).toBe(2)
    expect(rows[0].without_four_eyes).toBe(1)
    expect(rows[0].pending).toBe(1)
  })
})
