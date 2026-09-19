import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanupOldSyncJobs, getAllSyncJobs, getFailedSyncJobsGrouped } from '~/db/sync-jobs.server'
import { seedRepository, truncateAllTables } from './helpers'

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

async function insertRunningJob(opts: { jobType: string; repositoryId?: number | null }): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, locked_by, lock_expires_at)
     VALUES ($1, NULL, $2, 'running', NOW(), 'test', NOW() + INTERVAL '10 minutes')
     RETURNING id`,
    [opts.jobType, opts.repositoryId ?? null],
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
