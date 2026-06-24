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

async function seedGoalStructure(pool: Pool) {
  const sectionId = await seedSection(pool, 'sec')
  const devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
  const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app1', environment: 'prod' })

  const { rows: boardRows } = await pool.query(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
     VALUES ($1, 'Board', 'tertiary', '2026-01-01', '2026-04-30', 'T1 2026') RETURNING *`,
    [devTeamId],
  )
  const board = boardRows[0]

  const { rows: objRows } = await pool.query(
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Objective A', 0) RETURNING *",
    [board.id],
  )
  const objective = objRows[0]

  const { rows: kr1Rows } = await pool.query(
    "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR 1', 0) RETURNING *",
    [objective.id],
  )
  const keyResult1 = kr1Rows[0]

  const { rows: kr2Rows } = await pool.query(
    "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR 2', 1) RETURNING *",
    [objective.id],
  )
  const keyResult2 = kr2Rows[0]

  return { appId, objective, keyResult1, keyResult2 }
}

describe('getDeploymentsPaginated with goal_key_result_id filter', () => {
  it('returns only deployments linked to the specified key result', async () => {
    const { appId, keyResult1, keyResult2 } = await seedGoalStructure(pool)

    const dep1 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })
    const dep2 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by)
       VALUES ($1, $2, 'commit_keyword', 'system')`,
      [dep1, keyResult1.id],
    )
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by)
       VALUES ($1, $2, 'commit_keyword', 'system')`,
      [dep2, keyResult2.id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_key_result_id: keyResult1.id,
    })

    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(dep1)
  })

  it('does not return deployments linked to the same objective but a different KR', async () => {
    const { appId, keyResult1, keyResult2 } = await seedGoalStructure(pool)

    const dep1 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by)
       VALUES ($1, $2, 'manual', 'Z990001')`,
      [dep1, keyResult2.id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_key_result_id: keyResult1.id,
    })

    expect(result.total).toBe(0)
  })

  it('does not return unlinked deployments', async () => {
    const { appId, keyResult1 } = await seedGoalStructure(pool)

    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_key_result_id: keyResult1.id,
    })

    expect(result.total).toBe(0)
  })

  it('does not match inactive links', async () => {
    const { appId, keyResult1 } = await seedGoalStructure(pool)

    const dep1 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'Z990001', false)`,
      [dep1, keyResult1.id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_key_result_id: keyResult1.id,
    })

    expect(result.total).toBe(0)
  })
})
