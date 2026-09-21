import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getSyncJobsForRepository } from '~/db/sync-jobs.server'
import { seedApp, seedRepository, truncateAllTables } from './helpers'

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

let repoIdCounter = 960000

async function seedRepo(suffix: string): Promise<number> {
  repoIdCounter++
  return seedRepository(pool, {
    githubRepoId: String(repoIdCounter),
    githubOwner: 'navikt',
    githubRepoName: `repo-getsyncjobs-${suffix}`,
  })
}

async function seedJob(opts: {
  jobType: string
  repositoryId: number | null
  monitoredAppId?: number | null
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, completed_at)
     VALUES ($1, $2, $3, 'completed', NOW(), NOW())
     RETURNING id`,
    [opts.jobType, opts.monitoredAppId ?? null, opts.repositoryId],
  )
  return rows[0].id
}

describe('getSyncJobsForRepository', () => {
  it('returns only jobs scoped to the requested repository, excluding app-scoped sibling jobs', async () => {
    const repo = await seedRepo('scope')
    const app = await seedApp(pool, { teamSlug: 'team-syncjobs', appName: 'app-syncjobs', environment: 'prod' })

    const repoJob = await seedJob({ jobType: 'fetch_verification_data', repositoryId: repo })
    await seedJob({ jobType: 'fetch_verification_data', repositoryId: null, monitoredAppId: app })

    const result = await getSyncJobsForRepository(repo)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(repoJob)
  })

  it('excludes jobs belonging to a different repository', async () => {
    const repoA = await seedRepo('a')
    const repoB = await seedRepo('b')

    const jobA = await seedJob({ jobType: 'reverify_app', repositoryId: repoA })
    await seedJob({ jobType: 'reverify_app', repositoryId: repoB })

    const result = await getSyncJobsForRepository(repoA)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(jobA)
  })

  it('filters by job type when provided', async () => {
    const repo = await seedRepo('jobtype')
    const fetchJob = await seedJob({ jobType: 'fetch_verification_data', repositoryId: repo })
    await seedJob({ jobType: 'reverify_app', repositoryId: repo })

    const result = await getSyncJobsForRepository(repo, { jobType: 'fetch_verification_data' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(fetchJob)
  })

  it('respects the limit option', async () => {
    const repo = await seedRepo('limit')
    await seedJob({ jobType: 'fetch_verification_data', repositoryId: repo })
    await seedJob({ jobType: 'fetch_verification_data', repositoryId: repo })
    await seedJob({ jobType: 'fetch_verification_data', repositoryId: repo })

    const result = await getSyncJobsForRepository(repo, { limit: 2 })
    expect(result).toHaveLength(2)
  })

  it('returns an empty array when the repository has no jobs', async () => {
    const repo = await seedRepo('empty')
    const result = await getSyncJobsForRepository(repo)
    expect(result).toEqual([])
  })
})
