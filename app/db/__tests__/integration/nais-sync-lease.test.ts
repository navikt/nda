import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { lockMonitoredAppSync } from '~/db/connection.server'
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

async function waitForBlockedQuery(queryText: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND query LIKE $1
       LIMIT 1`,
      [`%${queryText}%`],
    )
    if (result.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for blocked query: ${queryText}`)
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

  it('does not mark history complete when the lease expires while waiting for the app lock', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'lease-team',
      environment_name: 'prod-gcp',
      app_name: 'lease-waiting-app-lock',
    })
    const jobId = await createNaisSyncJob(app.id)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await lockMonitoredAppSync(client, app.id)

      const marking = markInitialNaisHistorySynced(app.id, jobId)
      await waitForBlockedQuery('pg_advisory_xact_lock')
      await client.query(
        "UPDATE sync_jobs SET lock_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
        [jobId],
      )
      await client.query('COMMIT')

      expect(await marking).toBe(false)
      expect((await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at).toBeNull()
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  it('does not complete a job when its lease expires while waiting for the job row', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'lease-team',
      environment_name: 'prod-gcp',
      app_name: 'lease-waiting-job-row',
    })
    const jobId = await createNaisSyncJob(app.id)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM sync_jobs WHERE id = $1 FOR UPDATE', [jobId])

      const completing = completeNaisSyncJob(jobId, {}, 'NAIS sync complete')
      await waitForBlockedQuery("SET status = 'completed'")
      await client.query(
        "UPDATE sync_jobs SET lock_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
        [jobId],
      )
      await client.query('COMMIT')

      expect(await completing).toBe(false)
      const job = await pool.query<{ status: string }>('SELECT status FROM sync_jobs WHERE id = $1', [jobId])
      expect(job.rows[0].status).toBe('running')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  it('does not renew a job when its lease expires while waiting for the job row', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'lease-team',
      environment_name: 'prod-gcp',
      app_name: 'lease-waiting-heartbeat-row',
    })
    const jobId = await createNaisSyncJob(app.id)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM sync_jobs WHERE id = $1 FOR UPDATE', [jobId])

      const heartbeat = heartbeatNaisSyncJob(jobId, 10)
      await waitForBlockedQuery('SET lock_expires_at =')
      await client.query(
        "UPDATE sync_jobs SET lock_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
        [jobId],
      )
      await client.query('COMMIT')

      expect(await heartbeat).toBe(false)
      const job = await pool.query<{ lease_expired: boolean }>(
        'SELECT lock_expires_at <= clock_timestamp() AS lease_expired FROM sync_jobs WHERE id = $1',
        [jobId],
      )
      expect(job.rows[0].lease_expired).toBe(true)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
})
