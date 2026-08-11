import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getObservedSyncIntervalMs } from '~/db/sync-jobs.server'
import { seedApp, truncateAllTables } from './helpers'

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

async function seedSyncJob(appId: number, jobType: string, status: string, startedAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, completed_at, locked_by, lock_expires_at)
     VALUES ($1, $2, $3, $4, $4, 'test', $4)`,
    [jobType, appId, status, startedAt],
  )
}

describe('getObservedSyncIntervalMs', () => {
  it('returns null when there are fewer than 2 completed jobs', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    await seedSyncJob(appId, 'github_verify', 'completed', new Date())

    const result = await getObservedSyncIntervalMs(appId, 'github_verify')

    expect(result).toBeNull()
  })

  it('returns the average gap between the most recent completed jobs', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const now = Date.now()

    await seedSyncJob(appId, 'github_verify', 'completed', new Date(now - 30 * 60_000))
    await seedSyncJob(appId, 'github_verify', 'completed', new Date(now - 20 * 60_000))
    await seedSyncJob(appId, 'github_verify', 'completed', new Date(now - 10 * 60_000))
    await seedSyncJob(appId, 'github_verify', 'completed', new Date(now))

    const result = await getObservedSyncIntervalMs(appId, 'github_verify')

    expect(result).toBeCloseTo(10 * 60_000, -2)
  })

  it('ignores non-completed jobs and jobs of a different type', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const now = Date.now()

    await seedSyncJob(appId, 'github_verify', 'completed', new Date(now - 10 * 60_000))
    await seedSyncJob(appId, 'github_verify', 'completed', new Date(now))
    await seedSyncJob(appId, 'github_verify', 'failed', new Date(now + 1000))
    await seedSyncJob(appId, 'nais_sync', 'completed', new Date(now + 2000))

    const result = await getObservedSyncIntervalMs(appId, 'github_verify')

    expect(result).toBeCloseTo(10 * 60_000, -2)
  })
})
