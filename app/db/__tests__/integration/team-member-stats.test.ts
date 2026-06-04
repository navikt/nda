/**
 * Integration tests: filtering deployment stats by team-member GitHub usernames.
 *
 * Covers:
 *   - getAppDeploymentStatsBatch with `deployerUsernames` filter
 *   - getDevTeamCoverageStats (new aggregated team coverage)
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getDevTeamCoverageStats } from '../../deployment-goal-links.server'
import { getAppDeploymentStatsBatch } from '../../deployments/stats.server'
import { type DeploymentFilters, getDeploymentsPaginated } from '../../deployments.server'
import { seedApp, truncateAllTables } from './helpers'

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

async function seedDeploy(
  appId: number,
  teamSlug: string,
  deployer: string | null,
  fourEyesStatus: string,
  createdAt: Date,
): Promise<number> {
  const naisId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO deployments (
       monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
       commit_sha, created_at, four_eyes_status, deployer_username
     ) VALUES ($1, $2, $3, 'test-app', 'prod', $4, $5, $6, $7)
     RETURNING id`,
    [appId, naisId, teamSlug, `sha-${naisId}`, createdAt, fourEyesStatus, deployer],
  )
  return rows[0].id
}

async function linkDeploymentToObjective(deploymentId: number, objectiveId: number) {
  await pool.query(
    `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, is_active)
     VALUES ($1, $2, 'manual', true)`,
    [deploymentId, objectiveId],
  )
}

async function seedBoardObjective(): Promise<number> {
  // Minimal board + objective so we can link deployments
  const sectionId = (
    await pool.query<{ id: number }>(`INSERT INTO sections (slug, name) VALUES ('s1-${Date.now()}', 's1') RETURNING id`)
  ).rows[0].id
  const teamId = (
    await pool.query<{ id: number }>(
      `INSERT INTO dev_teams (slug, name, section_id) VALUES ('t1', 't1', $1) RETURNING id`,
      [sectionId],
    )
  ).rows[0].id
  const boardId = (
    await pool.query<{ id: number }>(
      `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label, is_active)
       VALUES ($1, 'B', 'quarterly', '2025-01-01', '2025-03-31', 'Q1', true) RETURNING id`,
      [teamId],
    )
  ).rows[0].id
  const objId = (
    await pool.query<{ id: number }>(
      `INSERT INTO board_objectives (board_id, title, sort_order, is_active) VALUES ($1, 'O', 1, true) RETURNING id`,
      [boardId],
    )
  ).rows[0].id
  return objId
}

describe('getAppDeploymentStatsBatch with deployerUsernames filter', () => {
  it('counts only deployments by listed deployers', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const now = new Date()

    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', now)
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', now)
    await seedDeploy(appId, 'tx', 'bob', 'direct_push', now)
    await seedDeploy(appId, 'tx', 'mallory', 'approved_pr', now) // not a member

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], ['alice', 'bob'])
    const s = stats.get(appId)
    if (!s) throw new Error('expected stats for appId')

    expect(s.total).toBe(3)
    expect(s.with_four_eyes).toBe(2)
    expect(s.without_four_eyes).toBe(1)
  })

  it('returns zero counts but keeps last_deployment_id pointing to most recent deploy when deployerUsernames is empty', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const depId = await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date())

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], [])
    const s = stats.get(appId)
    if (!s) throw new Error('expected stats for appId')

    expect(s.total).toBe(0)
    expect(s.with_four_eyes).toBe(0)
    // last_deployment_id is intentionally not filtered by deployer — it always
    // reflects the most recent deploy to the app so the AppCard "last deployment"
    // link doesn't mislead users into thinking the app is stale.
    expect(s.last_deployment_id).toBe(depId)
  })

  it('keeps last_deployment_id pointing to most recent deploy regardless of deployer filter', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const earlier = new Date(Date.now() - 60_000)
    const later = new Date()
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', earlier)
    const nonMemberLatest = await seedDeploy(appId, 'tx', 'mallory', 'approved_pr', later)

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], ['alice'])
    const s = stats.get(appId)
    if (!s) throw new Error('expected stats for appId')

    expect(s.total).toBe(1) // only alice's deploy counted
    expect(s.last_deployment_id).toBe(nonMemberLatest) // but link points to most recent overall
  })

  it('preserves backwards-compatible behavior when deployerUsernames is undefined', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date())
    await seedDeploy(appId, 'tx', 'mallory', 'approved_pr', new Date())

    const stats = await getAppDeploymentStatsBatch([{ id: appId }])
    expect(stats.get(appId)?.total).toBe(2)
  })
})

describe('stats and paginated list consistency', () => {
  it('without_four_eyes count matches paginated list with same deployer filter', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const now = new Date()

    await seedDeploy(appId, 'tx', 'alice', 'direct_push', now) // not approved, by member
    await seedDeploy(appId, 'tx', 'bob', 'approved_pr', now) // approved, by member
    await seedDeploy(appId, 'tx', 'mallory', 'direct_push', now) // not approved, NOT member

    const teamMembers = ['alice', 'bob']

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], teamMembers)
    const s = stats.get(appId)
    if (!s) throw new Error('expected stats for appId')

    const listFilters: DeploymentFilters = {
      monitored_app_id: appId,
      four_eyes_status: 'not_approved',
      deployer_usernames: teamMembers,
      page: 1,
      per_page: 100,
    }
    const list = await getDeploymentsPaginated(listFilters)

    expect(s.without_four_eyes).toBe(list.total)
    expect(s.without_four_eyes).toBe(1)
  })

  it('PR creator matches count in both stats and paginated list', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const now = new Date()

    // Deployment by bot where team member is the PR creator
    const naisId = `deploy-pr-creator-${Date.now()}`
    await pool.query(
      `INSERT INTO deployments (
         monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
         commit_sha, created_at, four_eyes_status, deployer_username, github_pr_data
       ) VALUES ($1, $2, 'tx', 'a', 'prod', $3, $4, 'direct_push', 'deploy-bot', $5)`,
      [appId, naisId, `sha-${naisId}`, now, JSON.stringify({ creator: { username: 'alice' } })],
    )
    // Another deployment by a non-member
    await seedDeploy(appId, 'tx', 'mallory', 'direct_push', now)

    const teamMembers = ['alice']

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], teamMembers)
    const s = stats.get(appId)
    if (!s) throw new Error('expected stats for appId')

    const list = await getDeploymentsPaginated({
      monitored_app_id: appId,
      deployer_usernames: teamMembers,
      page: 1,
      per_page: 100,
    })

    // Both should count 1 (the deploy-bot deployment where alice is PR creator)
    expect(s.total).toBe(1)
    expect(list.total).toBe(1)
    expect(s.without_four_eyes).toBe(list.total)
  })
})

describe('getAppDeploymentStats / batch parity', () => {
  it('single-app result matches batch result for same app', async () => {
    const { getAppDeploymentStats } = await import('../../deployments/stats.server')
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: 2024 })
    const now = new Date()

    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', now)
    await seedDeploy(appId, 'tx', 'bob', 'direct_push', now)
    await seedDeploy(appId, 'tx', 'carol', 'pending', now)

    const single = await getAppDeploymentStats(appId, undefined, undefined, 2024)
    const batchMap = await getAppDeploymentStatsBatch([{ id: appId, audit_start_year: 2024 }])
    const batch = batchMap.get(appId)

    if (!batch) throw new Error('batch result missing')
    expect(single.total).toBe(batch.total)
    expect(single.with_four_eyes).toBe(batch.with_four_eyes)
    expect(single.without_four_eyes).toBe(batch.without_four_eyes)
    expect(single.pending_verification).toBe(batch.pending_verification)
    expect(single.four_eyes_percentage).toBe(batch.four_eyes_percentage)
    expect(single.last_deployment_id).toBe(batch.last_deployment_id)
    expect(single.missing_goal_links).toBe(batch.missing_goal_links)
    // No goal links seeded, so missing_goal_links should equal total
    expect(single.missing_goal_links).toBe(single.total)
  })

  it('date range filters apply identically in single and batch', async () => {
    const { getAppDeploymentStats } = await import('../../deployments/stats.server')
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const old = new Date('2023-06-15')
    const recent = new Date('2025-03-10')

    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', old)
    await seedDeploy(appId, 'tx', 'alice', 'direct_push', recent)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-12-31')

    const single = await getAppDeploymentStats(appId, startDate, endDate)
    const batchMap = await getAppDeploymentStatsBatch([{ id: appId }], undefined, { startDate, endDate })
    const batch = batchMap.get(appId)

    expect(single.total).toBe(1)
    if (!batch) throw new Error('batch result missing')
    expect(batch.total).toBe(1)
    expect(single.without_four_eyes).toBe(batch.without_four_eyes)
  })

  it('date range + deployer filter combined', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const recent = new Date('2025-03-10')

    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', recent)
    await seedDeploy(appId, 'tx', 'bob', 'direct_push', recent)
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date('2023-01-01')) // out of range

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-12-31')

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], ['alice'], { startDate, endDate })
    const s = stats.get(appId)

    if (!s) throw new Error('stats result missing')
    expect(s.total).toBe(1)
    expect(s.with_four_eyes).toBe(1)
    expect(s.without_four_eyes).toBe(0)
  })
})

describe('getDevTeamCoverageStats', () => {
  it('aggregates four-eyes and origin coverage filtered to team members', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const objectiveId = await seedBoardObjective()
    const now = new Date()
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const d1 = await seedDeploy(appId, 'tx', 'alice', 'approved_pr', now)
    const d2 = await seedDeploy(appId, 'tx', 'alice', 'direct_push', now)
    const d3 = await seedDeploy(appId, 'tx', 'bob', 'approved_pr', now)
    await seedDeploy(appId, 'tx', 'mallory', 'approved_pr', now) // excluded

    // Link two of the three member deploys to an objective
    await linkDeploymentToObjective(d1, objectiveId)
    await linkDeploymentToObjective(d3, objectiveId)
    void d2

    const result = await getDevTeamCoverageStats([appId], ['alice', 'bob'], since, until)
    expect(result.total).toBe(3)
    expect(result.with_four_eyes).toBe(2)
    expect(result.four_eyes_percentage).toBe(67)
    expect(result.with_origin).toBe(2)
    expect(result.origin_percentage).toBe(67)
  })

  it('returns zeros when there are no team members', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date())

    const r = await getDevTeamCoverageStats([appId], [], new Date(0), new Date())
    expect(r).toEqual({ total: 0, with_four_eyes: 0, four_eyes_percentage: 0, with_origin: 0, origin_percentage: 0 })
  })

  it('returns zeros when there are no apps', async () => {
    const r = await getDevTeamCoverageStats([], ['alice'], new Date(0), new Date())
    expect(r.total).toBe(0)
  })

  it('respects date window', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod' })
    const old = new Date('2020-01-01')
    const recent = new Date()

    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', old)
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', recent)

    const since = new Date(recent.getTime() - 24 * 60 * 60 * 1000)
    const until = new Date(recent.getTime() + 24 * 60 * 60 * 1000)
    const r = await getDevTeamCoverageStats([appId], ['alice'], since, until)
    expect(r.total).toBe(1)
  })
})

async function seedBaselineApproval(deploymentId: number, changedBy: string | null = 'Z990001'): Promise<void> {
  await pool.query(
    `INSERT INTO deployment_status_history
       (deployment_id, from_status, to_status, changed_by, change_source, created_at)
     VALUES ($1, 'pending_baseline', 'baseline', $2, 'baseline_approval', NOW())`,
    [deploymentId, changedBy],
  )
}

describe('baseline_action_count in getAppDeploymentStatsBatch', () => {
  it('counts pending_baseline deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    await seedDeploy(appId, 'tx', 'alice', 'pending_baseline', new Date())
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date())

    const stats = await getAppDeploymentStatsBatch([{ id: appId }])
    expect(stats.get(appId)?.baseline_action_count).toBe(1)
  })

  it('counts baseline deployments missing an attributed baseline_approval', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    const noApprover = await seedDeploy(appId, 'tx', 'alice', 'baseline', new Date())
    // No deployment_status_history row → missing approver
    void noApprover

    const stats = await getAppDeploymentStatsBatch([{ id: appId }])
    expect(stats.get(appId)?.baseline_action_count).toBe(1)
  })

  it('excludes baseline deployments that have an attributed baseline_approval', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    const withApprover = await seedDeploy(appId, 'tx', 'alice', 'baseline', new Date())
    await seedBaselineApproval(withApprover, 'Z990001')

    const stats = await getAppDeploymentStatsBatch([{ id: appId }])
    expect(stats.get(appId)?.baseline_action_count).toBe(0)
  })

  it('is not date-filtered — counts baseline actions outside the selected period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    const old = new Date('2023-01-15')
    await seedDeploy(appId, 'tx', 'alice', 'pending_baseline', old)

    // Applying a recent date range should NOT suppress the baseline_action_count
    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-12-31')
    const stats = await getAppDeploymentStatsBatch([{ id: appId }], undefined, { startDate, endDate })
    expect(stats.get(appId)?.baseline_action_count).toBe(1)

    // But total (date-filtered) should be 0 — proving the date filter applies to other counts
    expect(stats.get(appId)?.total).toBe(0)
  })

  it('is not deployer-filtered — counts baseline actions regardless of who deployed', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    // Deployed by a non-member
    await seedDeploy(appId, 'tx', 'outsider', 'pending_baseline', new Date())

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], ['alice', 'bob'])
    expect(stats.get(appId)?.baseline_action_count).toBe(1)

    // But total (deployer-filtered) should be 0
    expect(stats.get(appId)?.total).toBe(0)
  })
})

describe('getDeploymentsPaginated with baseline_action filter', () => {
  it('returns pending_baseline deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    await seedDeploy(appId, 'tx', 'alice', 'pending_baseline', new Date())
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date())

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      four_eyes_status: 'baseline_action',
      page: 1,
      per_page: 100,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].four_eyes_status).toBe('pending_baseline')
  })

  it('returns baseline deployments missing an attributed baseline_approval', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    await seedDeploy(appId, 'tx', 'alice', 'baseline', new Date())
    // No deployment_status_history row → missing approver

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      four_eyes_status: 'baseline_action',
      page: 1,
      per_page: 100,
    })
    expect(result.total).toBe(1)
  })

  it('excludes baseline deployments that have an attributed baseline_approval', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    const withApprover = await seedDeploy(appId, 'tx', 'alice', 'baseline', new Date())
    await seedBaselineApproval(withApprover, 'Z990002')

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      four_eyes_status: 'baseline_action',
      page: 1,
      per_page: 100,
    })
    expect(result.total).toBe(0)
  })

  it('returns both pending_baseline and baseline-without-approver in the same list', async () => {
    const appId = await seedApp(pool, { teamSlug: 'tx', appName: 'a', environment: 'prod', auditStartYear: null })
    await seedDeploy(appId, 'tx', 'alice', 'pending_baseline', new Date())
    const noApprover = await seedDeploy(appId, 'tx', 'alice', 'baseline', new Date())
    void noApprover
    const withApprover = await seedDeploy(appId, 'tx', 'alice', 'baseline', new Date())
    await seedBaselineApproval(withApprover, 'Z990003')
    await seedDeploy(appId, 'tx', 'alice', 'approved_pr', new Date())

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      four_eyes_status: 'baseline_action',
      page: 1,
      per_page: 100,
    })
    expect(result.total).toBe(2)
  })
})
