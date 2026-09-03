import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPendingVerificationCount } from '~/db/deployments/stats.server'
import { seedApp, seedApplicationRepository, seedDeployment, truncateAllTables } from './helpers'

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

describe('getPendingVerificationCount', () => {
  it('counts pending, unknown and error statuses as pending, but not pending_approval', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'unknown',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'error',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_approval',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'approved',
    })

    const result = await getPendingVerificationCount(appId)

    expect(result.total).toBe(5)
    expect(result.pending).toBe(3)
  })

  it('counts pending_baseline as pending when the app shares an active repo with another app (monorepo)', async () => {
    const soloAppId = await seedApp(pool, { teamSlug: 'team-1', appName: 'solo-repo-app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: soloAppId,
      githubOwner: 'navikt',
      githubRepo: 'solo-repo',
      githubRepoId: '111',
    })
    await seedDeployment(pool, {
      monitoredAppId: soloAppId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })

    const soloResult = await getPendingVerificationCount(soloAppId)
    expect(soloResult.total).toBe(1)
    expect(soloResult.pending).toBe(0)

    const monorepoAppId = await seedApp(pool, { teamSlug: 'team-1', appName: 'monorepo-app-a', environment: 'prod' })
    const monorepoSiblingId = await seedApp(pool, {
      teamSlug: 'team-1',
      appName: 'monorepo-app-b',
      environment: 'prod',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: monorepoAppId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo',
      githubRepoId: '222',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: monorepoSiblingId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo',
      githubRepoId: '222',
    })
    await seedDeployment(pool, {
      monitoredAppId: monorepoAppId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })

    const monorepoResult = await getPendingVerificationCount(monorepoAppId)
    expect(monorepoResult.total).toBe(1)
    expect(monorepoResult.pending).toBe(1)
  })

  it('does not count pending_baseline as pending when the only sharing sibling app is inactive', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-with-inactive-sibling', environment: 'prod' })
    const inactiveSiblingId = await seedApp(pool, {
      teamSlug: 'team-1',
      appName: 'inactive-sibling',
      environment: 'prod',
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo-inactive-sibling',
      githubRepoId: '333',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: inactiveSiblingId,
      githubOwner: 'navikt',
      githubRepo: 'shared-repo-inactive-sibling',
      githubRepoId: '333',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })

    const result = await getPendingVerificationCount(appId)
    expect(result.total).toBe(1)
    expect(result.pending).toBe(0)
  })

  it('counts pending_baseline as pending when the app has an active repo row with github_repo_id not yet backfilled', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-pending-backfill', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'not-yet-backfilled',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })

    const result = await getPendingVerificationCount(appId)
    expect(result.total).toBe(1)
    expect(result.pending).toBe(1)
  })

  it('returns zeros for an app with no deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'empty-app', environment: 'prod' })

    const result = await getPendingVerificationCount(appId)

    expect(result.total).toBe(0)
    expect(result.pending).toBe(0)
  })
})
