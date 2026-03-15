import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

async function seedGoalLinkStack(pool: Pool) {
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
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Objective', 0) RETURNING *",
    [board.id],
  )
  const objective = objRows[0]

  const { rows: krRows } = await pool.query(
    "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0) RETURNING *",
    [objective.id],
  )
  const keyResult = krRows[0]

  return { sectionId, devTeamId, appId, board, objective, keyResult }
}

describe('deployment-goal-links', () => {
  it('links a deployment to an objective', async () => {
    const { appId, objective } = await seedGoalLinkStack(pool)
    const deploymentId = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by)
       VALUES ($1, $2, 'manual', 'alice')`,
      [deploymentId, objective.id],
    )

    const { rows } = await pool.query('SELECT * FROM deployment_goal_links WHERE deployment_id = $1', [deploymentId])
    expect(rows).toHaveLength(1)
    expect(rows[0].objective_id).toBe(objective.id)
    expect(rows[0].link_method).toBe('manual')
  })

  it('links a deployment to a key result', async () => {
    const { appId, keyResult } = await seedGoalLinkStack(pool)
    const deploymentId = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method)
       VALUES ($1, $2, 'commit_keyword')`,
      [deploymentId, keyResult.id],
    )

    const { rows } = await pool.query('SELECT * FROM deployment_goal_links WHERE deployment_id = $1', [deploymentId])
    expect(rows).toHaveLength(1)
    expect(rows[0].key_result_id).toBe(keyResult.id)
  })

  it('links a deployment with an external URL', async () => {
    const { appId } = await seedGoalLinkStack(pool)
    const deploymentId = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, external_url, external_url_title, link_method)
       VALUES ($1, 'https://jira/ISSUE-1', 'ISSUE-1', 'manual')`,
      [deploymentId],
    )

    const { rows } = await pool.query('SELECT * FROM deployment_goal_links WHERE deployment_id = $1', [deploymentId])
    expect(rows[0].external_url).toBe('https://jira/ISSUE-1')
    expect(rows[0].external_url_title).toBe('ISSUE-1')
  })

  it('getOriginOfChangeCoverage counts correctly with direct app IDs', async () => {
    const { appId } = await seedGoalLinkStack(pool)
    const now = new Date()
    const d1 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: now,
    })
    const _d2 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      createdAt: now,
    })
    // Only link d1
    await pool.query(
      "INSERT INTO deployment_goal_links (deployment_id, external_url, link_method) VALUES ($1, 'https://x', 'manual')",
      [d1],
    )

    const startDate = new Date(now.getTime() - 60_000)
    const endDate = new Date(now.getTime() + 60_000)

    const { rows } = await pool.query(
      `SELECT COUNT(DISTINCT d.id) AS total, COUNT(DISTINCT dgl.deployment_id) AS linked
       FROM deployments d
       LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
       WHERE d.monitored_app_id IN ($1)
         AND d.created_at >= $2 AND d.created_at < $3`,
      [appId, startDate, endDate],
    )
    expect(Number(rows[0].total)).toBe(2)
    expect(Number(rows[0].linked)).toBe(1)
  })

  it('getOriginOfChangeCoverage returns 0 for empty team', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(DISTINCT d.id) AS total, COUNT(DISTINCT dgl.deployment_id) AS linked
       FROM deployments d
       LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
       WHERE d.team_slug IN ('nonexistent')
         AND d.created_at >= $1 AND d.created_at < $2`,
      [new Date('2020-01-01'), new Date('2030-01-01')],
    )
    expect(Number(rows[0].total)).toBe(0)
    expect(Number(rows[0].linked)).toBe(0)
  })
})
