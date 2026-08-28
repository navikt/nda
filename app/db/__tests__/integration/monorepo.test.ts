import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getAllMonorepoGroups, getMonorepoSiblings } from '../../monorepo.server'
import { seedApp, seedApplicationRepository, truncateAllTables } from './helpers'

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

async function setDefaultBranch(appId: number, branch: string): Promise<void> {
  await pool.query('UPDATE monitored_applications SET default_branch = $1 WHERE id = $2', [branch, appId])
}

async function setAuditStartYear(appId: number, year: number | null): Promise<void> {
  await pool.query('UPDATE monitored_applications SET audit_start_year = $1 WHERE id = $2', [year, appId])
}

async function setAppInactive(appId: number): Promise<void> {
  await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [appId])
}

describe('getAllMonorepoGroups', () => {
  const owner = 'navikt'
  const repo = 'monorepo-example'

  it('should return an empty list when no repo is shared by multiple apps', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'solo-app', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(0)
  })

  it('should detect a monorepo when two active apps share an active repo', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].github_owner).toBe(owner)
    expect(groups[0].github_repo_name).toBe(repo)
    expect(groups[0].apps.map((a) => a.app_name).sort()).toEqual(['service-a', 'service-b'])
  })

  it('should not count historical or pending_approval repository links', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: owner,
      githubRepo: repo,
      status: 'historical',
    })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(0)
  })

  it('should not include apps that are inactive', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setAppInactive(appB)

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(0)
  })

  it('should flag base_branch_mismatch when apps have different default branches', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setDefaultBranch(appA, 'main')
    await setDefaultBranch(appB, 'master')

    const groups = await getAllMonorepoGroups()
    expect(groups[0].base_branch_mismatch).toBe(true)
  })

  it('should not flag base_branch_mismatch when apps share the same default branch', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setDefaultBranch(appA, 'main')
    await setDefaultBranch(appB, 'main')

    const groups = await getAllMonorepoGroups()
    expect(groups[0].base_branch_mismatch).toBe(false)
  })

  it('should flag audit_year_mismatch when apps have different audit start years', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'service-a',
      environment: 'prod',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'service-b',
      environment: 'prod',
      auditStartYear: 2025,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups[0].audit_year_mismatch).toBe(true)
  })

  it('should not flag audit_year_mismatch when apps share the same audit start year', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'service-a',
      environment: 'prod',
      auditStartYear: 2025,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'service-b',
      environment: 'prod',
      auditStartYear: 2025,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups[0].audit_year_mismatch).toBe(false)
  })

  it('should keep separate repos as separate groups', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    const appC = await seedApp(pool, { teamSlug: 'team-c', appName: 'service-c', environment: 'prod' })
    const appD = await seedApp(pool, { teamSlug: 'team-d', appName: 'service-d', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appC, githubOwner: owner, githubRepo: 'other-repo' })
    await seedApplicationRepository(pool, { monitoredAppId: appD, githubOwner: owner, githubRepo: 'other-repo' })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(2)
  })
})

describe('getMonorepoSiblings', () => {
  const owner = 'navikt'
  const repo = 'monorepo-example'

  it('should return null when the app has no active repository', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'solo-app', environment: 'prod' })

    const info = await getMonorepoSiblings(appId)
    expect(info).toBeNull()
  })

  it('should return null when no other app shares the repo', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'solo-app', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: owner, githubRepo: repo })

    const info = await getMonorepoSiblings(appId)
    expect(info).toBeNull()
  })

  it('should return siblings excluding the app itself', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const info = await getMonorepoSiblings(appA)
    expect(info).not.toBeNull()
    expect(info?.github_owner).toBe(owner)
    expect(info?.github_repo_name).toBe(repo)
    expect(info?.siblings.map((s) => s.id)).toEqual([appB])
  })

  it('should compute mismatch flags including the app itself', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setDefaultBranch(appA, 'main')
    await setDefaultBranch(appB, 'master')
    await setAuditStartYear(appA, 2025)
    await setAuditStartYear(appB, 2025)

    const info = await getMonorepoSiblings(appA)
    expect(info?.base_branch_mismatch).toBe(true)
    expect(info?.audit_year_mismatch).toBe(false)
  })

  it('should not include inactive sibling apps', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setAppInactive(appB)

    const info = await getMonorepoSiblings(appA)
    expect(info).toBeNull()
  })

  it('should return null when the app itself is inactive, even if active apps share its repo', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setAppInactive(appA)

    const info = await getMonorepoSiblings(appA)
    expect(info).toBeNull()
  })
})
