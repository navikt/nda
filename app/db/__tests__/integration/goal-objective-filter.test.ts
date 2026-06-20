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

  const { rows: obj1Rows } = await pool.query(
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Objective A', 0) RETURNING *",
    [board.id],
  )
  const objectiveA = obj1Rows[0]

  const { rows: obj2Rows } = await pool.query(
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Objective B', 1) RETURNING *",
    [board.id],
  )
  const objectiveB = obj2Rows[0]

  const { rows: krRows } = await pool.query(
    "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR for A', 0) RETURNING *",
    [objectiveA.id],
  )
  const keyResultA = krRows[0]

  return { appId, objectiveA, objectiveB, keyResultA }
}

describe('getDeploymentsPaginated with goal_objective_id filter', () => {
  it('filters by direct objective link', async () => {
    const { appId, objectiveA, objectiveB } = await seedGoalStructure(pool)

    const dep1 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })
    const dep2 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by)
       VALUES ($1, $2, 'manual', 'alice')`,
      [dep1, objectiveA.id],
    )
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by)
       VALUES ($1, $2, 'manual', 'bob')`,
      [dep2, objectiveB.id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_objective_id: objectiveA.id,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(dep1)
  })

  it('filters by indirect link via key result', async () => {
    const { appId, objectiveA, keyResultA } = await seedGoalStructure(pool)

    const dep1 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by)
       VALUES ($1, $2, 'commit_keyword', 'system')`,
      [dep1, keyResultA.id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_objective_id: objectiveA.id,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(dep1)
  })

  it('returns no duplicates when deployment has multiple links to same objective', async () => {
    const { appId, objectiveA, keyResultA } = await seedGoalStructure(pool)

    const dep1 = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by)
       VALUES ($1, $2, 'manual', 'alice')`,
      [dep1, objectiveA.id],
    )
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by)
       VALUES ($1, $2, 'commit_keyword', 'system')`,
      [dep1, keyResultA.id],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_objective_id: objectiveA.id,
    })
    expect(result.total).toBe(1)
    expect(result.deployments).toHaveLength(1)
    expect(result.deployments[0].id).toBe(dep1)
  })

  it('does not return unlinked deployments', async () => {
    const { appId, objectiveA } = await seedGoalStructure(pool)

    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      goal_objective_id: objectiveA.id,
    })
    expect(result.total).toBe(0)
    expect(result.deployments).toHaveLength(0)
  })
})
