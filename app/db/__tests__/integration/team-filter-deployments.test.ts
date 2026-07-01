import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getDeploymentsPaginated } from '~/db/deployments.server'
import { getMembersGithubUsernamesForDevTeamRoles } from '~/db/role-assignments.server'
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

async function seedUser(navIdent: string, githubUsername: string) {
  await pool.query(`INSERT INTO users (nav_ident, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    navIdent,
    navIdent,
  ])
  await pool.query(
    `INSERT INTO user_github_accounts (github_username, nav_ident) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [githubUsername, navIdent],
  )
}

async function joinDevTeam(navIdent: string, devTeamId: number) {
  await pool.query(
    `INSERT INTO dev_team_role_assignments (nav_ident, dev_team_id, role, assigned_by)
     VALUES ($1, $2, 'utvikler', 'test')
     ON CONFLICT DO NOTHING`,
    [navIdent, devTeamId],
  )
}

describe('getMembersGithubUsernamesForDevTeamRoles', () => {
  it('returns empty array for empty input', async () => {
    expect(await getMembersGithubUsernamesForDevTeamRoles([])).toEqual([])
  })

  it('returns deduplicated github usernames across multiple teams', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    await seedUser('A111111', 'alice')
    await seedUser('B222222', 'bob')
    await seedUser('C333333', 'carol')
    await joinDevTeam('A111111', teamA)
    await joinDevTeam('A111111', teamB)
    await joinDevTeam('B222222', teamA)
    await joinDevTeam('C333333', teamB)

    const usernames = await getMembersGithubUsernamesForDevTeamRoles([teamA, teamB])
    expect(usernames.sort()).toEqual(['alice', 'bob', 'carol'])
  })

  it('skips users without a github_username mapping', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const team = await seedDevTeam(pool, 'team-x', 'Team X', sectionId)
    await seedUser('A111111', 'alice')
    await joinDevTeam('A111111', team)
    await joinDevTeam('B222222', team)

    const usernames = await getMembersGithubUsernamesForDevTeamRoles([team])
    expect(usernames).toEqual(['alice'])
  })

  it('excludes soft-deleted user mappings', async () => {
    const sectionId = await seedSection(pool, 'sec')
    const team = await seedDevTeam(pool, 'team-y', 'Team Y', sectionId)
    await seedUser('A111111', 'alice')
    await seedUser('B222222', 'bob')
    await pool.query(`UPDATE user_github_accounts SET deleted_at = NOW() WHERE nav_ident = 'B222222'`)
    await joinDevTeam('A111111', team)
    await joinDevTeam('B222222', team)

    const usernames = await getMembersGithubUsernamesForDevTeamRoles([team])
    expect(usernames).toEqual(['alice'])
  })
})

describe('getDeploymentsPaginated with deployer_usernames filter', () => {
  it('filters deployments to the given usernames', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'bob',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'carol',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      deployer_usernames: ['alice', 'carol'],
    })
    expect(result.total).toBe(2)
    const deployers = result.deployments.map((d) => d.deployer_username).sort()
    expect(deployers).toEqual(['alice', 'carol'])
  })

  it('returns zero rows when given an empty username list', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'alice',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      deployer_usernames: [],
    })
    expect(result.total).toBe(0)
    expect(result.deployments).toHaveLength(0)
  })

  it('combines with deployer_username filter as AND', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'bob',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      deployer_username: 'alice',
      deployer_usernames: ['alice', 'bob'],
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].deployer_username).toBe('alice')

    const conflict = await getDeploymentsPaginated({
      monitored_app_id: appId,
      deployer_username: 'alice',
      deployer_usernames: ['bob'],
    })
    expect(conflict.total).toBe(0)
  })
})

describe('unmapped_deployers filter', () => {
  it('returns only deployments where deployer has no active user_github_accounts entry', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    await seedUser('A111111', 'mapped-user')
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      deployerUsername: 'mapped-user',
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      deployerUsername: 'unmapped-user',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      unmapped_deployers: true,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].deployer_username).toBe('unmapped-user')
  })

  it('treats soft-deleted mapping as unmapped', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    await seedUser('B222222', 'soft-deleted-user')
    await pool.query("UPDATE user_github_accounts SET deleted_at = NOW() WHERE github_username = 'soft-deleted-user'")

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      deployerUsername: 'soft-deleted-user',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      unmapped_deployers: true,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].deployer_username).toBe('soft-deleted-user')
  })

  it('excludes deployments with null/empty deployer_username', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      deployerUsername: null,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      deployerUsername: 'unmapped-deployer',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      unmapped_deployers: true,
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].deployer_username).toBe('unmapped-deployer')
  })
})

describe('exclude_deployer_usernames filter', () => {
  it('excludes deployments by the given usernames', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'bob',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'carol',
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      exclude_deployer_usernames: ['alice', 'bob'],
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].deployer_username).toBe('carol')
  })

  it('includes deployments with NULL deployer (not excluded)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: null,
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      exclude_deployer_usernames: ['alice'],
    })
    expect(result.total).toBe(1)
    expect(result.deployments[0].deployer_username).toBeNull()
  })

  it('excludes PR-creator matches too', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'deploy-bot',
      githubPrData: { creator: { username: 'alice' } },
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      deployerUsername: 'deploy-bot',
      githubPrData: { creator: { username: 'external-dev' } },
    })

    const result = await getDeploymentsPaginated({
      monitored_app_id: appId,
      exclude_deployer_usernames: ['alice', 'deploy-bot'],
    })
    expect(result.total).toBe(0)
  })
})
