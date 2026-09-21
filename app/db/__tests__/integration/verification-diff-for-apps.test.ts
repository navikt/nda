import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getApprovedDeploymentsMissingApproverForApps,
  getVerificationDiffsForApps,
} from '../../verification-diff.server'
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
})

const IN_PERIOD = new Date('2026-06-15T10:00:00Z')

async function seedVerificationDiff(
  pool: Pool,
  opts: { monitoredAppId: number; deploymentId: number; oldStatus: string | null; newStatus: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO verification_diffs (monitored_app_id, deployment_id, old_status, new_status)
     VALUES ($1, $2, $3, $4)`,
    [opts.monitoredAppId, opts.deploymentId, opts.oldStatus, opts.newStatus],
  )
}

describe('getVerificationDiffsForApps', () => {
  it('returns diffs only for the requested app IDs, excluding other apps', async () => {
    const includedApp = await seedApp(pool, { teamSlug: 'team-diff-a', appName: 'app-diff-a', environment: 'prod' })
    const excludedApp = await seedApp(pool, { teamSlug: 'team-diff-b', appName: 'app-diff-b', environment: 'prod' })

    const includedDeployment = await seedDeployment(pool, {
      monitoredAppId: includedApp,
      teamSlug: 'team-diff-a',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })
    const excludedDeployment = await seedDeployment(pool, {
      monitoredAppId: excludedApp,
      teamSlug: 'team-diff-b',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })

    await seedVerificationDiff(pool, {
      monitoredAppId: includedApp,
      deploymentId: includedDeployment,
      oldStatus: 'approved',
      newStatus: 'rejected',
    })
    await seedVerificationDiff(pool, {
      monitoredAppId: excludedApp,
      deploymentId: excludedDeployment,
      oldStatus: 'approved',
      newStatus: 'rejected',
    })

    const result = await getVerificationDiffsForApps([includedApp])
    expect(result).toHaveLength(1)
    expect(result[0].deployment_id).toBe(includedDeployment)
    expect(result[0].monitored_app_id).toBe(includedApp)
  })

  it('returns diffs for multiple requested app IDs', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-diff-c', appName: 'app-diff-c', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-diff-d', appName: 'app-diff-d', environment: 'prod' })

    const depA = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-diff-c',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })
    const depB = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-diff-d',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })

    await seedVerificationDiff(pool, {
      monitoredAppId: appA,
      deploymentId: depA,
      oldStatus: 'approved',
      newStatus: 'rejected',
    })
    await seedVerificationDiff(pool, {
      monitoredAppId: appB,
      deploymentId: depB,
      oldStatus: 'approved',
      newStatus: 'rejected',
    })

    const result = await getVerificationDiffsForApps([appA, appB])
    const ids = result.map((r) => r.deployment_id)
    expect(ids).toContain(depA)
    expect(ids).toContain(depB)
  })

  it('returns an empty array when given an empty app ID list', async () => {
    const result = await getVerificationDiffsForApps([])
    expect(result).toEqual([])
  })
})

describe('getApprovedDeploymentsMissingApproverForApps', () => {
  it('returns missing-approver deployments only for the requested app IDs, excluding other apps', async () => {
    const includedApp = await seedApp(pool, { teamSlug: 'team-mafa', appName: 'app-mafa-a', environment: 'prod' })
    const excludedApp = await seedApp(pool, { teamSlug: 'team-mafb', appName: 'app-mafa-b', environment: 'prod' })

    const includedDeployment = await seedDeployment(pool, {
      monitoredAppId: includedApp,
      teamSlug: 'team-mafa',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubPrData: { reviewers: [] },
    })
    await seedDeployment(pool, {
      monitoredAppId: excludedApp,
      teamSlug: 'team-mafb',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubPrData: { reviewers: [] },
    })

    const result = await getApprovedDeploymentsMissingApproverForApps([includedApp])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(includedDeployment)
    expect(result[0].monitored_app_id).toBe(includedApp)
  })

  it('excludes deployments with an APPROVED reviewer even when app ID is included', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-mafc', appName: 'app-mafc', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-mafc',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-06-15T09:00:00Z' }],
      },
    })

    const result = await getApprovedDeploymentsMissingApproverForApps([appId])
    expect(result).toHaveLength(0)
  })

  it('returns an empty array when given an empty app ID list', async () => {
    const result = await getApprovedDeploymentsMissingApproverForApps([])
    expect(result).toEqual([])
  })

  it('includes team_slug and app_name fields', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-mafd', appName: 'app-mafd', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-mafd',
      appName: 'app-mafd',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubPrData: { reviewers: [] },
    })

    const result = await getApprovedDeploymentsMissingApproverForApps([appId])
    expect(result).toHaveLength(1)
    expect(result[0].team_slug).toBe('team-mafd')
    expect(result[0].app_name).toBe('app-mafd')
  })
})
