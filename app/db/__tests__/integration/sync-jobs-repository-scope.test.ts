import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  acquireSyncLock,
  acquireSyncLockForRepository,
  cleanupOldSyncJobs,
  forceReleaseSyncJob,
  getAllSyncJobs,
  getFailedSyncJobsGrouped,
} from '~/db/sync-jobs.server'
import { seedApp, seedApplicationRepository, seedRepository, truncateAllTables } from './helpers'

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

async function insertRunningJob(opts: {
  jobType: string
  repositoryId?: number | null
  lockExpiresInMinutes?: number
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, locked_by, lock_expires_at)
     VALUES ($1, NULL, $2, 'running', NOW(), 'test', NOW() + INTERVAL '1 minute' * $3)
     RETURNING id`,
    [opts.jobType, opts.repositoryId ?? null, opts.lockExpiresInMinutes ?? 10],
  )
  return rows[0].id
}

let repoIdCounter = 950000

async function seedRepo(pool: Pool, suffix: string): Promise<number> {
  repoIdCounter++
  return seedRepository(pool, {
    githubRepoId: String(repoIdCounter),
    githubOwner: 'navikt',
    githubRepoName: `repo-${suffix}`,
  })
}

async function seedCompletedJob(opts: { repositoryId: number | null; createdAt: Date }): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, completed_at, created_at)
     VALUES ('fetch_verification_data', NULL, $1, 'completed', $2, $2, $2)
     RETURNING id`,
    [opts.repositoryId, opts.createdAt],
  )
  return rows[0].id
}

async function seedFailedJob(opts: { repositoryId: number | null; error: string }): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, completed_at, error)
     VALUES ('fetch_verification_data', NULL, $1, 'failed', NOW(), NOW(), $2)
     RETURNING id`,
    [opts.repositoryId, opts.error],
  )
  return rows[0].id
}

describe('sync_jobs repository-scoped lock indexes', () => {
  it('allows two running jobs of the same type for different repositories', async () => {
    const repoA = await seedRepo(pool, 'a')
    const repoB = await seedRepo(pool, 'b')

    await insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: repoA })

    await expect(insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: repoB })).resolves.toEqual(
      expect.any(Number),
    )
  })

  it('rejects a second running job of the same type for the same repository', async () => {
    const repoA = await seedRepo(pool, 'a')

    await insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: repoA })

    await expect(insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: repoA })).rejects.toThrow(
      /unique|duplicate/,
    )
  })

  it('rejects a second running true-global job of the same type', async () => {
    await insertRunningJob({ jobType: 'backfill_workflow_triggers', repositoryId: null })

    await expect(insertRunningJob({ jobType: 'backfill_workflow_triggers', repositoryId: null })).rejects.toThrow(
      /unique|duplicate/,
    )
  })

  it('allows a repository-scoped job and a true-global job of the same type at the same time', async () => {
    const repoA = await seedRepo(pool, 'a')

    await insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: repoA })

    await expect(insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: null })).resolves.toEqual(
      expect.any(Number),
    )
  })
})

describe('acquireSyncLockForRepository / acquireSyncLock cross-scope conflict handling', () => {
  it('rejects a second repository-scoped lock for the same repository', async () => {
    const repoA = await seedRepo(pool, 'lock-a')

    const first = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(first).toEqual(expect.any(Number))

    const second = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(second).toBeNull()
  })

  it('allows repository-scoped locks for different repositories to run in parallel', async () => {
    const repoA = await seedRepo(pool, 'lock-b')
    const repoB = await seedRepo(pool, 'lock-c')

    const first = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    const second = await acquireSyncLockForRepository('fetch_verification_data', repoB)

    expect(first).toEqual(expect.any(Number))
    expect(second).toEqual(expect.any(Number))
  })

  it('blocks a repository-scoped lock when an app-scoped job is running for a linked (active) app', async () => {
    const repoA = await seedRepo(pool, 'lock-d')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-d', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-d',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const appJobId = await acquireSyncLock('fetch_verification_data', appId)
    expect(appJobId).toEqual(expect.any(Number))

    const repoJobId = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(repoJobId).toBe('app_conflict')
  })

  it('blocks an app-scoped lock when a repository-scoped job is running for a linked (active) repository', async () => {
    const repoA = await seedRepo(pool, 'lock-e')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-e', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-e',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const repoJobId = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(repoJobId).toEqual(expect.any(Number))

    const appJobId = await acquireSyncLock('fetch_verification_data', appId)
    expect(appJobId).toBe('repository_conflict')
  })

  it('blocks a repository-scoped lock when an app-scoped job is running for a historically linked app', async () => {
    const repoA = await seedRepo(pool, 'lock-f')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-f', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-f',
      githubRepoId: String(repoIdCounter),
      status: 'historical',
    })

    const appJobId = await acquireSyncLock('fetch_verification_data', appId)
    expect(appJobId).toEqual(expect.any(Number))

    const repoJobId = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(repoJobId).toBe('app_conflict')
  })

  it('does not block across unrelated apps and repositories', async () => {
    const repoA = await seedRepo(pool, 'lock-g')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-g', environment: 'prod-gcp' })

    const appJobId = await acquireSyncLock('fetch_verification_data', appId)
    expect(appJobId).toEqual(expect.any(Number))

    const repoJobId = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(repoJobId).toEqual(expect.any(Number))
  })

  it('does not apply cross-scope conflict checks to job types without a repository-scoped counterpart', async () => {
    const repoA = await seedRepo(pool, 'lock-h')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-h', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-h',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const repoJobId = await acquireSyncLockForRepository('fetch_verification_data', repoA)
    expect(repoJobId).toEqual(expect.any(Number))

    const naisSyncJobId = await acquireSyncLock('nais_sync', appId)
    expect(naisSyncJobId).toEqual(expect.any(Number))
  })
})

describe('forceReleaseSyncJob', () => {
  it('force-releases a running job whose lock has expired', async () => {
    const jobId = await insertRunningJob({ jobType: 'fetch_verification_data', lockExpiresInMinutes: -5 })

    const released = await forceReleaseSyncJob(jobId)
    expect(released).toBe(true)

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM sync_jobs WHERE id = $1`, [jobId])
    expect(rows[0].status).toBe('failed')
  })

  it('does not release a running job whose lock has not yet expired', async () => {
    const jobId = await insertRunningJob({ jobType: 'fetch_verification_data', lockExpiresInMinutes: 10 })

    const released = await forceReleaseSyncJob(jobId)
    expect(released).toBe(false)

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM sync_jobs WHERE id = $1`, [jobId])
    expect(rows[0].status).toBe('running')
  })
})

describe('cleanupOldSyncJobs repository partitioning', () => {
  it('keeps each repository scope and the global scope independently pruned', async () => {
    const repoA = await seedRepo(pool, 'a')
    const repoB = await seedRepo(pool, 'b')
    const now = Date.now()
    const keepPerApp = 2

    for (let i = 0; i < 5; i++) {
      await seedCompletedJob({ repositoryId: repoA, createdAt: new Date(now - i * 1000) })
    }
    for (let i = 0; i < 5; i++) {
      await seedCompletedJob({ repositoryId: repoB, createdAt: new Date(now - i * 1000) })
    }
    for (let i = 0; i < 5; i++) {
      await seedCompletedJob({ repositoryId: null, createdAt: new Date(now - i * 1000) })
    }

    await cleanupOldSyncJobs(keepPerApp)

    const { rows: repoARows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM sync_jobs WHERE repository_id = $1`,
      [repoA],
    )
    const { rows: repoBRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM sync_jobs WHERE repository_id = $1`,
      [repoB],
    )
    const { rows: globalRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM sync_jobs WHERE repository_id IS NULL AND monitored_app_id IS NULL`,
    )

    expect(Number(repoARows[0].count)).toBe(keepPerApp)
    expect(Number(repoBRows[0].count)).toBe(keepPerApp)
    expect(Number(globalRows[0].count)).toBe(keepPerApp)

    const expectedRetainedOffsets = [0, 1000]

    async function retainedOffsetsMs(where: string, params: (number | null)[]): Promise<number[]> {
      const { rows } = await pool.query<{ created_at: Date }>(
        `SELECT created_at FROM sync_jobs WHERE ${where} ORDER BY created_at DESC`,
        params,
      )
      return rows.map((row) => now - row.created_at.getTime())
    }

    const repoAOffsets = await retainedOffsetsMs('repository_id = $1', [repoA])
    const repoBOffsets = await retainedOffsetsMs('repository_id = $1', [repoB])
    const globalOffsets = await retainedOffsetsMs('repository_id IS NULL AND monitored_app_id IS NULL', [])

    for (const [index, offset] of expectedRetainedOffsets.entries()) {
      expect(repoAOffsets[index]).toBeCloseTo(offset, -2)
      expect(repoBOffsets[index]).toBeCloseTo(offset, -2)
      expect(globalOffsets[index]).toBeCloseTo(offset, -2)
    }
  })
})

describe('getAllSyncJobs repository filtering and projection', () => {
  it('filters by repositoryId and returns the matching repository owner/name, excluding other repositories', async () => {
    const repoA = await seedRepo(pool, 'a')
    const repoB = await seedRepo(pool, 'b')

    const jobIdA = await seedCompletedJob({ repositoryId: repoA, createdAt: new Date() })
    await seedCompletedJob({ repositoryId: repoB, createdAt: new Date() })

    const jobs = await getAllSyncJobs({ repositoryId: repoA })

    expect(jobs).toHaveLength(1)
    expect(jobs[0].id).toBe(jobIdA)
    expect(jobs[0].github_owner).toBe('navikt')
    expect(jobs[0].github_repo_name).toBe('repo-a')
  })
})

describe('getFailedSyncJobsGrouped repository projection', () => {
  it('keeps failures from different repositories in separate groups with their own repository identity', async () => {
    const repoA = await seedRepo(pool, 'a')
    const repoB = await seedRepo(pool, 'b')

    await seedFailedJob({ repositoryId: repoA, error: 'boom' })
    await seedFailedJob({ repositoryId: repoB, error: 'boom' })

    const grouped = await getFailedSyncJobsGrouped()

    const groupA = grouped.find((g) => g.repository_id === repoA)
    const groupB = grouped.find((g) => g.repository_id === repoB)

    expect(groupA).toBeDefined()
    expect(groupB).toBeDefined()
    expect(groupA?.github_owner).toBe('navikt')
    expect(groupA?.github_repo_name).toBe('repo-a')
    expect(groupB?.github_owner).toBe('navikt')
    expect(groupB?.github_repo_name).toBe('repo-b')
    expect(groupA?.failure_count).toBe(1)
    expect(groupB?.failure_count).toBe(1)
  })
})
