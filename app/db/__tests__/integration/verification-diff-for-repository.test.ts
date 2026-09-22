import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getApprovedDeploymentsMissingApproverForApps,
  getVerificationDiffsForRepository,
} from '../../verification-diff.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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
  opts: {
    monitoredAppId: number
    deploymentId: number
    oldStatus: string | null
    newStatus: string
    repositoryId?: number | null
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO verification_diffs (monitored_app_id, deployment_id, old_status, new_status, repository_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [opts.monitoredAppId, opts.deploymentId, opts.oldStatus, opts.newStatus, opts.repositoryId ?? null],
  )
}

describe('getVerificationDiffsForRepository', () => {
  it('returns diffs only for the requested repository ID, excluding other repositories', async () => {
    const includedRepoId = await seedRepository(pool, {
      githubRepoId: '900001',
      githubOwner: 'navikt',
      githubRepoName: 'diff-a',
    })
    const excludedRepoId = await seedRepository(pool, {
      githubRepoId: '900002',
      githubOwner: 'navikt',
      githubRepoName: 'diff-b',
    })
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
      repositoryId: includedRepoId,
    })
    await seedVerificationDiff(pool, {
      monitoredAppId: excludedApp,
      deploymentId: excludedDeployment,
      oldStatus: 'approved',
      newStatus: 'rejected',
      repositoryId: excludedRepoId,
    })

    const result = await getVerificationDiffsForRepository(includedRepoId, [includedApp])
    expect(result).toHaveLength(1)
    expect(result[0].deployment_id).toBe(includedDeployment)
    expect(result[0].monitored_app_id).toBe(includedApp)
  })

  it('excludes diffs with a NULL repository_id (not yet recomputed since the migration)', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '900003',
      githubOwner: 'navikt',
      githubRepoName: 'diff-c',
    })
    const appId = await seedApp(pool, { teamSlug: 'team-diff-c', appName: 'app-diff-c', environment: 'prod' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-diff-c',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })

    await seedVerificationDiff(pool, {
      monitoredAppId: appId,
      deploymentId,
      oldStatus: 'approved',
      newStatus: 'rejected',
      repositoryId: null,
    })

    const result = await getVerificationDiffsForRepository(repoId, [appId])
    expect(result).toEqual([])
  })

  it('excludes diffs whose app is no longer in the authorized app ID list, even when repository_id matches', async () => {
    // Simulates a stale row: the diff was computed while the app was active/authorized,
    // but the app was since deactivated (or otherwise dropped from affectedApps) — the
    // repository_id alone must not be enough to surface it, since the action handlers
    // reject writes for apps outside that same authorized set.
    const repoId = await seedRepository(pool, {
      githubRepoId: '900004',
      githubOwner: 'navikt',
      githubRepoName: 'diff-d',
    })
    const authorizedApp = await seedApp(pool, { teamSlug: 'team-diff-d', appName: 'app-diff-d', environment: 'prod' })
    const staleApp = await seedApp(pool, { teamSlug: 'team-diff-e', appName: 'app-diff-e', environment: 'prod' })

    const authorizedDeployment = await seedDeployment(pool, {
      monitoredAppId: authorizedApp,
      teamSlug: 'team-diff-d',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })
    const staleDeployment = await seedDeployment(pool, {
      monitoredAppId: staleApp,
      teamSlug: 'team-diff-e',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
    })

    await seedVerificationDiff(pool, {
      monitoredAppId: authorizedApp,
      deploymentId: authorizedDeployment,
      oldStatus: 'approved',
      newStatus: 'rejected',
      repositoryId: repoId,
    })
    await seedVerificationDiff(pool, {
      monitoredAppId: staleApp,
      deploymentId: staleDeployment,
      oldStatus: 'approved',
      newStatus: 'rejected',
      repositoryId: repoId,
    })

    const result = await getVerificationDiffsForRepository(repoId, [authorizedApp])
    expect(result).toHaveLength(1)
    expect(result[0].deployment_id).toBe(authorizedDeployment)
  })

  it('returns an empty array when given an empty app ID list', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '900005',
      githubOwner: 'navikt',
      githubRepoName: 'diff-f',
    })
    const result = await getVerificationDiffsForRepository(repoId, [])
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
