import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { findRootApprovedSiblingForCommit } from '~/lib/verification/fetch-data/previous-deployment.server'
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

describe('findRootApprovedSiblingForCommit', () => {
  it('accepts a same-app root with a different base only for a same-SHA redeploy', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    const currentId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9001',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: currentId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9001',
    })

    const rootId = await seedDeployment(pool, {
      monitoredAppId: currentId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    const redeployRoot = await findRootApprovedSiblingForCommit('head-sha', '9001', 'head-sha', undefined, currentId)
    const differentRangeRoot = await findRootApprovedSiblingForCommit(
      'head-sha',
      '9001',
      'different-base-sha',
      undefined,
      currentId,
    )

    expect(redeployRoot?.id).toBe(rootId)
    expect(redeployRoot?.monitoredAppId).toBe(currentId)
    expect(differentRangeRoot).toBeNull()
  })

  it('excludes the deployment being reverified from its root lookup', async () => {
    const siblingAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    const currentAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: siblingAppId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9002',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: currentAppId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9002',
    })
    await seedDeployment(pool, {
      monitoredAppId: siblingAppId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      fourEyesStatus: 'pending',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const currentDeploymentId = await seedDeployment(pool, {
      monitoredAppId: currentAppId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    const root = await findRootApprovedSiblingForCommit(
      'head-sha',
      '9002',
      'base-sha',
      currentDeploymentId,
      currentAppId,
    )

    expect(root).toBeNull()
  })

  it('does not accept a root through a historical repo link after the app moved to another repository', async () => {
    const rootAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'old-app', environment: 'prod' })
    const currentAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'current-app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: rootAppId,
      githubOwner: 'navikt',
      githubRepo: 'old-monorepo',
      githubRepoId: '9003',
      status: 'historical',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: rootAppId,
      githubOwner: 'navikt',
      githubRepo: 'new-repository',
      githubRepoId: '9004',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: currentAppId,
      githubOwner: 'navikt',
      githubRepo: 'old-monorepo',
      githubRepoId: '9003',
    })
    await seedDeployment(pool, {
      monitoredAppId: rootAppId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'shared-head',
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'old-monorepo',
    })

    const root = await findRootApprovedSiblingForCommit('shared-head', '9003', 'shared-base', undefined, currentAppId)

    expect(root).toBeNull()
  })
})
