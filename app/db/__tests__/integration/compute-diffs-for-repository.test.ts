import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { acquireSyncLockForRepository } from '~/db/sync-jobs.server'
import { computeVerificationDiffsForRepository } from '~/lib/verification/compute-diffs.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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

let repoIdCounter = 970000

async function seedRepo(suffix: string): Promise<number> {
  repoIdCounter++
  return seedRepository(pool, {
    githubRepoId: String(repoIdCounter),
    githubOwner: 'navikt',
    githubRepoName: `repo-cdfr-${suffix}`,
  })
}

async function insertJobWithStatus(status: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, status, started_at, completed_at, locked_by, lock_expires_at)
     VALUES ('reverify_app', $1, NOW(), NOW(), 'test', NOW() + INTERVAL '10 minutes')
     RETURNING id`,
    [status],
  )
  return rows[0].id
}

describe('computeVerificationDiffsForRepository', () => {
  it('aggregates results across multiple apps linked to the repository', async () => {
    const repoId = await seedRepo('agg')
    const appA = await seedApp(pool, { teamSlug: 'team-cdfr', appName: 'app-cdfr-agg-a', environment: 'prod-gcp' })
    const appB = await seedApp(pool, { teamSlug: 'team-cdfr', appName: 'app-cdfr-agg-b', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-agg',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-agg',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })
    await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-cdfr',
      environment: 'prod-gcp',
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-agg',
    })
    await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-cdfr',
      environment: 'prod-gcp',
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-agg',
    })
    await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-cdfr',
      environment: 'prod-gcp',
      fourEyesStatus: 'manually_approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-agg',
    })

    const result = await computeVerificationDiffsForRepository(repoId)

    expect(result.appsTotal).toBe(2)
    expect(result.appsProcessed).toBe(2)
    expect(result.deploymentsChecked).toBe(3)
    expect(result.skipped).toBe(3)
    expect(result.diffsFound).toBe(0)
    expect(result.appsSkippedLocked).toBe(0)
    expect(result.stoppedEarly).toBe(false)
  })

  it('reports per-app progress via onProgress as each app finishes', async () => {
    const repoId = await seedRepo('progress')
    const appA = await seedApp(pool, {
      teamSlug: 'team-cdfr',
      appName: 'app-cdfr-progress-a',
      environment: 'prod-gcp',
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-cdfr',
      appName: 'app-cdfr-progress-b',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-progress',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-progress',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const progressCalls: Array<[number, number, number]> = []
    await computeVerificationDiffsForRepository(repoId, {
      onProgress: (processedApps, totalApps, diffsFound) => {
        progressCalls.push([processedApps, totalApps, diffsFound])
      },
    })

    expect(progressCalls).toEqual([
      [1, 2, 0],
      [2, 2, 0],
    ])
  })

  it('returns an empty, non-erroring result when the repository has no linked apps', async () => {
    const repoId = await seedRepo('empty')

    const result = await computeVerificationDiffsForRepository(repoId)

    expect(result.appsTotal).toBe(0)
    expect(result.appsProcessed).toBe(0)
    expect(result.deploymentsChecked).toBe(0)
  })

  it('skips an app that is blocked by a reverify job already running for another repository it is linked to', async () => {
    const repoA = await seedRepo('multi-a')
    const repoB = await seedRepo('multi-b')
    const sharedApp = await seedApp(pool, {
      teamSlug: 'team-cdfr',
      appName: 'app-cdfr-multi-shared',
      environment: 'prod-gcp',
    })
    const onlyRepoAApp = await seedApp(pool, {
      teamSlug: 'team-cdfr',
      appName: 'app-cdfr-multi-only-a',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: sharedApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-multi-a',
      githubRepoId: String(repoIdCounter - 1),
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: sharedApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-multi-b',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: onlyRepoAApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-multi-a',
      githubRepoId: String(repoIdCounter - 1),
      status: 'active',
    })

    // Another reverify job is already running for repoB, which `sharedApp` is also linked to.
    const otherJobId = await acquireSyncLockForRepository('reverify_app', repoB)
    expect(otherJobId).toEqual(expect.any(Number))

    // Our own (hypothetical) repoA job doesn't need a real row for this check — only used as an
    // "exclude this job id" sentinel so we don't self-conflict.
    const result = await computeVerificationDiffsForRepository(repoA, { jobId: -1 })

    expect(result.appsTotal).toBe(2)
    expect(result.appsSkippedLocked).toBe(1)
    expect(result.appsProcessed).toBe(2)
  })

  it('stops processing before the first app when the job has already been cancelled', async () => {
    const repoId = await seedRepo('cancelled')
    const appA = await seedApp(pool, {
      teamSlug: 'team-cdfr',
      appName: 'app-cdfr-cancelled-a',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-cancelled',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const jobId = await insertJobWithStatus('cancelled')

    const result = await computeVerificationDiffsForRepository(repoId, { jobId })

    expect(result.stoppedEarly).toBe(true)
    expect(result.appsProcessed).toBe(0)
    expect(result.deploymentsChecked).toBe(0)
  })

  it('stops processing before the first app when the job has been force-released (failed)', async () => {
    const repoId = await seedRepo('force-released')
    const appA = await seedApp(pool, {
      teamSlug: 'team-cdfr',
      appName: 'app-cdfr-force-released-a',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-cdfr-force-released',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const jobId = await insertJobWithStatus('failed')

    const result = await computeVerificationDiffsForRepository(repoId, { jobId })

    expect(result.stoppedEarly).toBe(true)
    expect(result.appsProcessed).toBe(0)
    expect(result.deploymentsChecked).toBe(0)
  })
})
