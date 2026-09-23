import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { lockRepositoryForVerificationJob, VERIFICATION_JOB_LOCK_NAMESPACE } from '~/db/connection.server'
import {
  acquireSyncLock,
  acquireSyncLockForRepository,
  cleanupOldSyncJobs,
  forceReleaseSyncJob,
  getAllSyncJobs,
  getFailedSyncJobsGrouped,
  getSyncJobRepositories,
  isAppBlockedByRunningJob,
} from '~/db/sync-jobs.server'
import {
  seedApp,
  seedApplicationRepository,
  seedRepository,
  truncateAllTables,
  waitForAdvisoryLockWaiter,
} from './helpers'

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

async function getGithubRepoId(repositoryId: number): Promise<string> {
  const { rows } = await pool.query<{ github_repo_id: string }>(
    'SELECT github_repo_id FROM repositories WHERE id = $1',
    [repositoryId],
  )
  return rows[0].github_repo_id
}

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

describe('acquireSyncLock repository-linked job type guard', () => {
  it('throws when called with a repository-linked job type instead of acquireSyncLockForRepository', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-guard', environment: 'prod-gcp' })

    await expect(acquireSyncLock('fetch_verification_data', appId)).rejects.toThrow(
      /must be acquired via acquireSyncLockForRepository/,
    )
    await expect(acquireSyncLock('reverify_app', appId)).rejects.toThrow(
      /must be acquired via acquireSyncLockForRepository/,
    )
    await expect(acquireSyncLock('refresh_missing_approver', appId)).rejects.toThrow(
      /must be acquired via acquireSyncLockForRepository/,
    )
  })
})

describe('acquireSyncLockForRepository cross-scope conflict handling', () => {
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

  it('blocks a repository-scoped lock when a true-global job of the same type is running', async () => {
    const repoA = await seedRepo(pool, 'lock-global-a')
    await insertRunningJob({ jobType: 'refresh_missing_approver', repositoryId: null })

    const repoJobId = await acquireSyncLockForRepository('refresh_missing_approver', repoA)
    expect(repoJobId).toBe('app_conflict')
  })
})

describe('acquireSyncLockForRepository genuine concurrent acquisition', () => {
  it('blocks acquireSyncLockForRepository until a transaction holding the same per-repository lock commits', async () => {
    const repoA = await seedRepo(pool, 'concurrent-a')
    const holder = await pool.connect()
    let resolved = false
    let committed = false

    try {
      const githubRepoIdA = await getGithubRepoId(repoA)
      await holder.query('BEGIN')
      await lockRepositoryForVerificationJob(holder, githubRepoIdA)

      const pending = acquireSyncLockForRepository('fetch_verification_data', repoA).then((result) => {
        resolved = true
        return result
      })

      await waitForAdvisoryLockWaiter(pool, VERIFICATION_JOB_LOCK_NAMESPACE, githubRepoIdA)
      expect(resolved).toBe(false)

      await holder.query('COMMIT')
      committed = true

      const result = await pending
      expect(resolved).toBe(true)
      expect(result).toEqual(expect.any(Number))
    } finally {
      if (!committed) {
        await holder.query('ROLLBACK').catch(() => {})
      }
      holder.release()
    }
  })
})

describe('isAppBlockedByRunningJob', () => {
  it('returns true when a repository-scoped fetch job is running for a linked (active) app', async () => {
    const repoA = await seedRepo(pool, 'lock-i')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-i', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-i',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    await acquireSyncLockForRepository('fetch_verification_data', repoA)

    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data'])).toBe(true)
  })

  it('returns true when a repository-scoped fetch job is running for a historically linked app', async () => {
    const repoA = await seedRepo(pool, 'lock-j')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-j', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-j',
      githubRepoId: String(repoIdCounter),
      status: 'historical',
    })

    await acquireSyncLockForRepository('fetch_verification_data', repoA)

    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data'])).toBe(true)
  })

  it('returns true when an app-scoped fetch job is running for the app itself', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-m', environment: 'prod-gcp' })

    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at)
       VALUES ('fetch_verification_data', $1, 'running', NOW(), 'test', NOW() + INTERVAL '10 minutes')`,
      [appId],
    )

    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data'])).toBe(true)
  })

  it('returns false when the app has no linked repository with a running fetch job', async () => {
    await seedRepo(pool, 'lock-k')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-k', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-k',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    // A repository-scoped job runs for an unrelated repository, not the app's own.
    const unrelatedRepo = await seedRepo(pool, 'lock-k-unrelated')
    await acquireSyncLockForRepository('fetch_verification_data', unrelatedRepo)

    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data'])).toBe(false)
  })

  it("returns false when the repository-scoped fetch job's lock has expired", async () => {
    const repoA = await seedRepo(pool, 'lock-l')
    const appId = await seedApp(pool, { teamSlug: 'team-lock', appName: 'app-lock-l', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-l',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    await insertRunningJob({ jobType: 'fetch_verification_data', repositoryId: repoA, lockExpiresInMinutes: -5 })

    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data'])).toBe(false)
  })

  it('returns true when a repository-scoped reverify job is running for a linked app, when checking reverify_app', async () => {
    const repoA = await seedRepo(pool, 'lock-reverify-a')
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-reverify-a',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-reverify-a',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    await acquireSyncLockForRepository('reverify_app', repoA)

    expect(await isAppBlockedByRunningJob(appId, ['reverify_app'])).toBe(true)
    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data'])).toBe(false)
  })

  it('checks multiple job types at once when given an array', async () => {
    const repoA = await seedRepo(pool, 'lock-reverify-b')
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-reverify-b',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-reverify-b',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    await acquireSyncLockForRepository('reverify_app', repoA)

    expect(await isAppBlockedByRunningJob(appId, ['fetch_verification_data', 'reverify_app'])).toBe(true)
  })

  it('excludes the given job id from the conflict check (does not block against itself)', async () => {
    const repoA = await seedRepo(pool, 'lock-reverify-c')
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-reverify-c',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-reverify-c',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const ownJobId = await acquireSyncLockForRepository('reverify_app', repoA)
    expect(ownJobId).toEqual(expect.any(Number))

    expect(await isAppBlockedByRunningJob(appId, ['reverify_app'], ownJobId as number)).toBe(false)
    expect(await isAppBlockedByRunningJob(appId, ['reverify_app'])).toBe(true)
  })

  it('returns true when a repository-scoped reverify job is running for a different repository the app is also linked to', async () => {
    const repoB = await seedRepo(pool, 'lock-reverify-d-b')
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-reverify-d',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-reverify-d-a',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-reverify-d-b',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const jobForRepoB = await acquireSyncLockForRepository('reverify_app', repoB)
    expect(jobForRepoB).toEqual(expect.any(Number))

    // A separate reverify job for a different repository the app is also linked to (repoA, not
    // seeded as its own job here) should see the app as blocked, since it is also linked to repoB
    // where a reverify job is already running.
    expect(await isAppBlockedByRunningJob(appId, ['reverify_app'])).toBe(true)
  })

  it('returns true for any app when a global reverify_all job is running, regardless of the app being linked to anything', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-reverify-all-e',
      environment: 'prod-gcp',
    })

    await insertRunningJob({ jobType: 'reverify_all', repositoryId: null })

    expect(await isAppBlockedByRunningJob(appId, ['reverify_all'])).toBe(true)
  })

  it('returns false for a running reverify_all job when it is not part of the requested job types', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-reverify-all-f',
      environment: 'prod-gcp',
    })

    await insertRunningJob({ jobType: 'reverify_all', repositoryId: null })

    expect(await isAppBlockedByRunningJob(appId, ['reverify_app'])).toBe(false)
  })

  it('returns true when a repository-scoped refresh_missing_approver job is running for a linked app, when checking reverify_app together with refresh_missing_approver', async () => {
    const repoA = await seedRepo(pool, 'lock-refresh-g')
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-refresh-g',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-refresh-g',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    await acquireSyncLockForRepository('refresh_missing_approver', repoA)

    expect(await isAppBlockedByRunningJob(appId, ['reverify_app', 'refresh_missing_approver'])).toBe(true)
    expect(await isAppBlockedByRunningJob(appId, ['reverify_app'])).toBe(false)
  })

  it('returns true when a repository-scoped refresh_missing_approver job is running for a sibling repository the app is also linked to', async () => {
    const repoA = await seedRepo(pool, 'lock-refresh-h-a')
    const repoB = await seedRepo(pool, 'lock-refresh-h-b')
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-refresh-h',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-refresh-h-a',
      githubRepoId: String(repoIdCounter - 1),
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-lock-refresh-h-b',
      githubRepoId: String(repoIdCounter),
      status: 'active',
    })

    const jobForRepoB = await acquireSyncLockForRepository('refresh_missing_approver', repoB)
    expect(jobForRepoB).toEqual(expect.any(Number))

    const jobForRepoA = await acquireSyncLockForRepository('refresh_missing_approver', repoA)
    expect(jobForRepoA).toEqual(expect.any(Number))

    expect(await isAppBlockedByRunningJob(appId, ['refresh_missing_approver'], jobForRepoA as number)).toBe(true)
  })

  it('returns true for any app when a true-global refresh_missing_approver job is running, regardless of the app being linked to anything', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-lock',
      appName: 'app-lock-refresh-all-i',
      environment: 'prod-gcp',
    })

    await insertRunningJob({ jobType: 'refresh_missing_approver', repositoryId: null })

    expect(await isAppBlockedByRunningJob(appId, ['refresh_missing_approver'])).toBe(true)
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

describe('getSyncJobRepositories', () => {
  it('returns distinct repositories that have at least one sync job, excluding repositories without any', async () => {
    const repoA = await seedRepo(pool, 'a')
    const repoB = await seedRepo(pool, 'b')
    await seedRepo(pool, 'c')

    await seedCompletedJob({ repositoryId: repoA, createdAt: new Date() })
    await seedCompletedJob({ repositoryId: repoA, createdAt: new Date() })
    await seedFailedJob({ repositoryId: repoB, error: 'boom' })

    const repositories = await getSyncJobRepositories()

    expect(repositories).toHaveLength(2)
    expect(repositories.map((r) => `${r.github_owner}/${r.github_repo_name}`).sort()).toEqual([
      'navikt/repo-a',
      'navikt/repo-b',
    ])
  })

  it('excludes app-scoped jobs with no repository_id', async () => {
    await seedCompletedJob({ repositoryId: null, createdAt: new Date() })

    const repositories = await getSyncJobRepositories()

    expect(repositories).toHaveLength(0)
  })
})
