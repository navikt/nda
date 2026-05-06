/**
 * Integration test: goal_filter='linked' with exclude_deployer_usernames
 * should only match goal links to the specified team's board when
 * goal_dev_team_id is provided.
 *
 * Bug: On the team deployments page with deployer=__non_member__ & goal=linked,
 * the query returned deployments linked to ANY team's board — not just the
 * current team's board. This caused the count (750) to not match the team
 * page's "Fra andre" count (8).
 */

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

async function seedBoardWithObjective(pool: Pool, devTeamId: number, title: string) {
  const { rows: boardRows } = await pool.query(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label, is_active)
     VALUES ($1, $2, 'tertiary', '2026-01-01', '2026-04-30', 'T1 2026', true) RETURNING id`,
    [devTeamId, title],
  )
  const boardId = boardRows[0].id

  const { rows: objRows } = await pool.query(
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Objective', 0) RETURNING id",
    [boardId],
  )
  return { boardId, objectiveId: objRows[0].id }
}

describe('non-member goal filter should be scoped to team board', () => {
  it('goal_filter=linked without goal_dev_team_id returns deployments linked to ANY board', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamA = await seedDevTeam(pool, 'starte-pensjon', 'Starte pensjon', sectionId)
    const teamB = await seedDevTeam(pool, 'other-team', 'Other Team', sectionId)

    // Shared app (both teams use it)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'shared-app', environment: 'prod' })

    // Create boards for each team
    const boardA = await seedBoardWithObjective(pool, teamA, 'Board A')
    const boardB = await seedBoardWithObjective(pool, teamB, 'Board B')

    // Non-member deploys
    const d1 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })
    const d2 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })

    // Link d1 to teamA's board
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d1, boardA.objectiveId],
    )
    // Link d2 to teamB's board
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d2, boardB.objectiveId],
    )

    // Without goal_dev_team_id, goal_filter=linked returns BOTH
    const result = await getDeploymentsPaginated({
      monitored_app_ids: [appId],
      goal_filter: 'linked',
      exclude_deployer_usernames: ['team-member'],
    })
    expect(result.total).toBe(2)
  })

  it('goal_filter=linked with goal_dev_team_id only returns deployments linked to THAT team board', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamA = await seedDevTeam(pool, 'starte-pensjon', 'Starte pensjon', sectionId)
    const teamB = await seedDevTeam(pool, 'other-team', 'Other Team', sectionId)

    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'shared-app', environment: 'prod' })

    const boardA = await seedBoardWithObjective(pool, teamA, 'Board A')
    const boardB = await seedBoardWithObjective(pool, teamB, 'Board B')

    // Non-member deploys
    const d1 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })
    const d2 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })
    const d3 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })

    // Link d1 to teamA's board
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d1, boardA.objectiveId],
    )
    // Link d2 to teamB's board
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d2, boardB.objectiveId],
    )
    // d3 has no link

    // With goal_dev_team_id=teamA, goal_filter=linked should only return d1
    const result = await getDeploymentsPaginated({
      monitored_app_ids: [appId],
      goal_filter: 'linked',
      goal_dev_team_id: teamA,
      exclude_deployer_usernames: ['team-member'],
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(d1)
  })

  it('goal_filter=missing with goal_dev_team_id returns deployments NOT linked to that team board', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamA = await seedDevTeam(pool, 'starte-pensjon', 'Starte pensjon', sectionId)
    const teamB = await seedDevTeam(pool, 'other-team', 'Other Team', sectionId)

    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'shared-app', environment: 'prod' })

    const boardA = await seedBoardWithObjective(pool, teamA, 'Board A')
    const boardB = await seedBoardWithObjective(pool, teamB, 'Board B')

    const d1 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })
    const d2 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })

    // d1 linked to teamA
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d1, boardA.objectiveId],
    )
    // d2 linked to teamB (should count as "missing" for teamA)
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d2, boardB.objectiveId],
    )

    // goal_filter=missing with goal_dev_team_id=teamA should return d2 (not linked to A's board)
    const result = await getDeploymentsPaginated({
      monitored_app_ids: [appId],
      goal_filter: 'missing',
      goal_dev_team_id: teamA,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(d2)
  })

  it('key_result links are also scoped to team board', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamA = await seedDevTeam(pool, 'starte-pensjon', 'Starte pensjon', sectionId)
    const teamB = await seedDevTeam(pool, 'other-team', 'Other Team', sectionId)

    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'shared-app', environment: 'prod' })

    const boardA = await seedBoardWithObjective(pool, teamA, 'Board A')
    const boardB = await seedBoardWithObjective(pool, teamB, 'Board B')

    // Add key results
    const { rows: krARows } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR A', 0) RETURNING id",
      [boardA.objectiveId],
    )
    const krA = krARows[0].id

    const { rows: krBRows } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR B', 0) RETURNING id",
      [boardB.objectiveId],
    )
    const krB = krBRows[0].id

    const d1 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })
    const d2 = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'nais-team',
      environment: 'prod',
      deployerUsername: 'outsider',
    })

    // d1 linked via key result to teamA's board
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d1, krA],
    )
    // d2 linked via key result to teamB's board
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method, linked_by, is_active)
       VALUES ($1, $2, 'manual', 'someone', true)`,
      [d2, krB],
    )

    const result = await getDeploymentsPaginated({
      monitored_app_ids: [appId],
      goal_filter: 'linked',
      goal_dev_team_id: teamA,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].id).toBe(d1)
  })
})
