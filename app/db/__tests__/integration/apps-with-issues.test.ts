import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getDevTeamAppsWithIssues } from '~/db/deployments/home.server'
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
  navIdentCounter = 1
})

let navIdentCounter = 1
async function seedGithubAccount(githubUsername: string): Promise<void> {
  const navIdent = `Z99${String(navIdentCounter++).padStart(4, '0')}`
  await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ($1, $2)`, [
    navIdent,
    `Name of ${githubUsername}`,
  ])
  await pool.query(`INSERT INTO user_github_accounts (github_username, nav_ident) VALUES ($1, $2)`, [
    githubUsername.toLowerCase(),
    navIdent,
  ])
}

async function seedObjective(): Promise<number> {
  const sectionId = (
    await pool.query<{ id: number }>(`INSERT INTO sections (slug, name) VALUES ('s-${Date.now()}', 'S') RETURNING id`)
  ).rows[0].id
  const teamId = (
    await pool.query<{ id: number }>(
      `INSERT INTO dev_teams (slug, name, section_id) VALUES ('team-a', 'Team A', $1) ON CONFLICT (slug) DO UPDATE SET name = 'Team A' RETURNING id`,
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
  return (
    await pool.query<{ id: number }>(
      `INSERT INTO board_objectives (board_id, title, sort_order, is_active) VALUES ($1, 'Obj', 0, true) RETURNING id`,
      [boardId],
    )
  ).rows[0].id
}

describe('getDevTeamAppsWithIssues - unmapped_deployer_count', () => {
  it('includes app with only unmapped deployers in results', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'unmapped-user',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].app_name).toBe('svc')
    expect(result[0].unmapped_deployer_count).toBe(1)
  })

  it('counts distinct unmapped deployers per app', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'bob',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].unmapped_deployer_count).toBe(2)
  })

  it('excludes bot accounts from unmapped count', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'dependabot[bot]',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'github-actions[bot]',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'real-person',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].unmapped_deployer_count).toBe(1)
  })

  it('excludes known non-bracket bot accounts (snyk-bot, semantic-release-bot)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'snyk-bot',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'semantic-release-bot',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'real-person',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].unmapped_deployer_count).toBe(1)
  })

  it('does not count mapped deployers', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    const deployId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'mapped-user',
      fourEyesStatus: 'approved',
    })
    await seedGithubAccount('mapped-user')
    const objectiveId = await seedObjective()
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, is_active) VALUES ($1, $2, 'manual', true)`,
      [deployId, objectiveId],
    )

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(0)
  })

  it('handles case-insensitive username matching', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    const deployId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'Alice',
      fourEyesStatus: 'approved',
    })
    await seedGithubAccount('alice')
    const objectiveId = await seedObjective()
    await pool.query(
      `INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method, is_active) VALUES ($1, $2, 'manual', true)`,
      [deployId, objectiveId],
    )

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(0)
  })

  it('excludes soft-deleted user mappings', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'alice',
      fourEyesStatus: 'approved',
    })
    await seedGithubAccount('alice')
    await pool.query(`UPDATE user_github_accounts SET deleted_at = NOW() WHERE github_username = 'alice'`)

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].unmapped_deployer_count).toBe(1)
  })

  it('respects audit_start_year for unmapped count', async () => {
    const currentYear = new Date().getFullYear()
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'svc',
      environment: 'prod',
      auditStartYear: currentYear,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'old-deployer',
      fourEyesStatus: 'approved',
      createdAt: new Date(currentYear - 1, 6, 1),
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'current-deployer',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].unmapped_deployer_count).toBe(1)
  })

  it('combines unmapped count with other issue types', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'unmapped-user',
      fourEyesStatus: 'direct_push',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'])
    expect(result).toHaveLength(1)
    expect(result[0].without_four_eyes).toBe(1)
    expect(result[0].unmapped_deployer_count).toBe(1)
  })

  it('unmapped_deployer_count is not affected by deployerUsernames filter', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      deployerUsername: 'outsider',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamAppsWithIssues(['team-a'], undefined, ['team-member'])
    expect(result).toHaveLength(1)
    expect(result[0].without_four_eyes).toBe(0)
    expect(result[0].unmapped_deployer_count).toBe(1)
  })
})

describe('getDevTeamAppsWithIssues - unrecognized four_eyes_status', () => {
  it('surfaces app as having issues when status is not in any known category', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'mystery', environment: 'prod' })
    await seedGithubAccount('deployer1')

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-x',
      environment: 'prod',
      deployerUsername: 'deployer1',
      fourEyesStatus: 'some_future_status_not_in_any_array',
    })

    const result = await getDevTeamAppsWithIssues(['team-x'], undefined)
    expect(result).toHaveLength(1)
    expect(result[0].without_four_eyes).toBe(1)
  })

  it('derives without_four_eyes correctly when mix of known and unknown statuses', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-y', appName: 'mixed', environment: 'prod' })
    await seedGithubAccount('deployer2')

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-y',
      environment: 'prod',
      deployerUsername: 'deployer2',
      fourEyesStatus: 'approved_pr',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-y',
      environment: 'prod',
      deployerUsername: 'deployer2',
      fourEyesStatus: 'baseline_migrated',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-y',
      environment: 'prod',
      deployerUsername: 'deployer2',
      fourEyesStatus: 'pending',
    })

    const result = await getDevTeamAppsWithIssues(['team-y'], undefined)
    expect(result).toHaveLength(1)
    expect(result[0].without_four_eyes).toBe(1)
    expect(result[0].pending_verification).toBe(1)
  })
})
