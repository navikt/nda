import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createMonitoredApplication,
  getMonitoredApplicationById,
  markInitialNaisHistorySynced,
} from '~/db/monitored-applications.server'
import { completeNaisSyncJob, heartbeatNaisSyncJob } from '~/db/sync-jobs.server'
import { truncateAllTables } from './helpers'

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

async function createNaisSyncJob(monitoredAppId: number, expired = false): Promise<number> {
  const expiry = expired ? "NOW() - INTERVAL '1 minute'" : "NOW() + INTERVAL '10 minutes'"
  const result = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, lock_expires_at)
     VALUES ('nais_sync', $1, 'running', NOW(), ${expiry})
     RETURNING id`,
    [monitoredAppId],
  )
  return result.rows[0].id
}

describe('NAIS sync lease', () => {
  it('sets the full-history marker only for a job with a current lease', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'lease-team',
      environment_name: 'prod-gcp',
      app_name: 'lease-app',
    })
    const currentJobId = await createNaisSyncJob(app.id)

    expect(await markInitialNaisHistorySynced(app.id, currentJobId)).toBe(true)
    const markerAfterCurrentJob = (await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at
    expect(markerAfterCurrentJob).toBeInstanceOf(Date)

    await pool.query('UPDATE monitored_applications SET initial_nais_history_synced_at = NULL WHERE id = $1', [app.id])
    expect(await completeNaisSyncJob(currentJobId, {}, 'NAIS sync complete')).toBe(true)
    const expiredJobId = await createNaisSyncJob(app.id, true)

    expect(await markInitialNaisHistorySynced(app.id, expiredJobId)).toBe(false)
    expect((await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at).toBeNull()
  })

  it('extends only current leases and atomically completes only active Nais jobs', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'lease-team',
      environment_name: 'prod-gcp',
      app_name: 'lease-completion-app',
    })
    const currentJobId = await createNaisSyncJob(app.id)

    expect(await heartbeatNaisSyncJob(currentJobId, 10)).toBe(true)
    expect(
      await completeNaisSyncJob(currentJobId, { initialHistorySyncStatus: 'completed' }, 'NAIS sync complete'),
    ).toBe(true)
    expect(await completeNaisSyncJob(currentJobId, {}, 'NAIS sync complete')).toBe(false)

    const expiredJobId = await createNaisSyncJob(app.id, true)
    expect(await heartbeatNaisSyncJob(expiredJobId, 10)).toBe(false)
    expect(await completeNaisSyncJob(expiredJobId, {}, 'NAIS sync complete')).toBe(false)

    const currentJob = await pool.query<{ status: string; result: Record<string, unknown> }>(
      'SELECT status, result FROM sync_jobs WHERE id = $1',
      [currentJobId],
    )
    expect(currentJob.rows[0]).toMatchObject({
      status: 'completed',
      result: { initialHistorySyncStatus: 'completed' },
    })
  })

  it('does not complete a cancelled Nais sync job', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'lease-team',
      environment_name: 'prod-gcp',
      app_name: 'cancelled-lease-app',
    })
    const jobId = await createNaisSyncJob(app.id)
    await pool.query("UPDATE sync_jobs SET status = 'cancelled' WHERE id = $1", [jobId])

    expect(await completeNaisSyncJob(jobId, {}, 'NAIS sync complete')).toBe(false)
  })
})
