import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getDeploymentsPaginated } from '~/db/deployments.server'
import { seedApp, seedDeployment, seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

describe('getDeploymentsPaginated with monitored_app_ids', () => {
  it('returns deployments from multiple apps', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'app-1', environment: 'prod' })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'app-2', environment: 'prod' })
    const app3 = await seedApp(pool, { teamSlug: 'team', appName: 'app-3', environment: 'prod' })

    await seedDeployment(pool, { monitoredAppId: app1, teamSlug: 'team', environment: 'prod' })
    await seedDeployment(pool, { monitoredAppId: app2, teamSlug: 'team', environment: 'prod' })
    await seedDeployment(pool, { monitoredAppId: app3, teamSlug: 'team', environment: 'prod' })

    const result = await getDeploymentsPaginated({ monitored_app_ids: [app1, app2] })
    expect(result.total).toBe(2)
    const appIds = result.deployments.map((d) => d.monitored_app_id)
    expect(appIds).toContain(app1)
    expect(appIds).toContain(app2)
    expect(appIds).not.toContain(app3)
  })

  it('combines with date range filter', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'app-1', environment: 'prod' })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'app-2', environment: 'prod' })

    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: new Date('2026-03-15'),
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: new Date('2026-01-10'),
    })
    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: new Date('2025-06-01'),
    })

    const result = await getDeploymentsPaginated({
      monitored_app_ids: [app1, app2],
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
    })
    expect(result.total).toBe(2)
  })

  it('combines with four_eyes_status filter', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'app-1', environment: 'prod' })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'app-2', environment: 'prod' })

    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team',
      environment: 'prod',
      fourEyesStatus: 'not_approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod',
      fourEyesStatus: 'not_approved',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_ids: [app1, app2],
      four_eyes_status: 'not_approved',
    })
    expect(result.total).toBe(2)
    for (const d of result.deployments) {
      expect(d.four_eyes_status).toBe('not_approved')
    }
  })

  it('combines with goal_filter missing', async () => {
    const sectionId = await seedSection(pool, 'sec')
    await seedDevTeam(pool, 'team', 'Team', sectionId)
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'app-1', environment: 'prod' })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'app-2', environment: 'prod' })

    const dep1 = await seedDeployment(pool, { monitoredAppId: app1, teamSlug: 'team', environment: 'prod' })
    const dep2 = await seedDeployment(pool, { monitoredAppId: app2, teamSlug: 'team', environment: 'prod' })

    const { rows: boardRows } = await pool.query(
      `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
       VALUES ((SELECT id FROM dev_teams WHERE slug = 'team'), 'Board', 'tertiary', '2026-01-01', '2026-04-30', 'T1') RETURNING id`,
    )
    const { rows: objRows } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING id",
      [boardRows[0].id],
    )
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by)
       VALUES ($1, $2, 'manual', 'alice')`,
      [dep1, objRows[0].id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_ids: [app1, app2],
      goal_filter: 'missing',
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(dep2)
  })

  it('respects per_app_audit_start_year', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'app-1', environment: 'prod', auditStartYear: 2026 })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'app-2', environment: 'prod', auditStartYear: 2025 })

    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: new Date('2025-06-15'),
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: new Date('2025-06-15'),
    })
    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: new Date('2026-02-01'),
    })

    const result = await getDeploymentsPaginated({
      monitored_app_ids: [app1, app2],
      per_app_audit_start_year: true,
    })
    expect(result.total).toBe(2)
  })

  it('returns all deployments when app_ids array is empty (no app filter applied)', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, { monitoredAppId: app1, teamSlug: 'team', environment: 'prod' })

    const result = await getDeploymentsPaginated({ monitored_app_ids: [] })
    expect(result.total).toBe(1)
  })
})
