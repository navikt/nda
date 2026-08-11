import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPendingVerificationCount } from '~/db/deployments/stats.server'
import { assignAppToGroup, seedApp, seedApplicationGroup, seedDeployment, truncateAllTables } from './helpers'

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

  it('only counts pending_baseline as pending when the app belongs to an application group', async () => {
    const standaloneAppId = await seedApp(pool, { teamSlug: 'team-1', appName: 'standalone-app', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: standaloneAppId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })

    const standaloneResult = await getPendingVerificationCount(standaloneAppId)
    expect(standaloneResult.total).toBe(1)
    expect(standaloneResult.pending).toBe(0)

    const groupedAppId = await seedApp(pool, { teamSlug: 'team-1', appName: 'grouped-app', environment: 'prod' })
    const groupId = await seedApplicationGroup(pool, 'test-group')
    await assignAppToGroup(pool, groupedAppId, groupId)
    await seedDeployment(pool, {
      monitoredAppId: groupedAppId,
      teamSlug: 'team-1',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })

    const groupedResult = await getPendingVerificationCount(groupedAppId)
    expect(groupedResult.total).toBe(1)
    expect(groupedResult.pending).toBe(1)
  })

  it('returns zeros for an app with no deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'empty-app', environment: 'prod' })

    const result = await getPendingVerificationCount(appId)

    expect(result.total).toBe(0)
    expect(result.pending).toBe(0)
  })
})
