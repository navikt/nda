import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { lockMonitoredAppSync } from '../../connection.server'
import {
  createMonitoredApplication,
  getMonitoredApplicationById,
  getNaisHistoryRecoveryCandidates,
  getNaisHistoryRiskApps,
  markInitialNaisHistorySynced,
  resetNaisHistorySyncMarker,
  updateMonitoredApplication,
} from '../../monitored-applications.server'
import { acquireSyncLock, releaseSyncLock } from '../../sync-jobs.server'
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

async function createActiveNaisSyncJob(monitoredAppId: number): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, lock_expires_at)
     VALUES ('nais_sync', $1, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
     RETURNING id`,
    [monitoredAppId],
  )
  return result.rows[0].id
}

describe('createMonitoredApplication', () => {
  it('bruker oppgitt default_branch', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-c',
      environment_name: 'prod-gcp',
      app_name: 'app-c',
      default_branch: 'master',
    })

    expect(app.default_branch).toBe('master')
  })

  it('nullstiller not_found_in_nais_at og reaktiverer ved ON CONFLICT (re-add)', async () => {
    const first = await createMonitoredApplication({
      team_slug: 'team-d',
      environment_name: 'prod-gcp',
      app_name: 'app-d',
      default_branch: 'main',
    })

    await updateMonitoredApplication(first.id, {
      is_active: false,
      not_found_in_nais_at: new Date(),
    })
    const deactivated = await getMonitoredApplicationById(first.id)
    expect(deactivated?.is_active).toBe(false)
    expect(deactivated?.not_found_in_nais_at).not.toBeNull()

    const readded = await createMonitoredApplication({
      team_slug: 'team-d',
      environment_name: 'prod-gcp',
      app_name: 'app-d',
      default_branch: 'main',
    })
    expect(readded.is_active).toBe(true)
    expect(readded.not_found_in_nais_at).toBeNull()
  })
})

describe('markInitialNaisHistorySynced', () => {
  it('records the first successful full-history sync time without replacing it later', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-e',
      environment_name: 'prod-gcp',
      app_name: 'app-e',
    })

    expect(app.initial_nais_history_synced_at).toBeNull()

    const jobId = await createActiveNaisSyncJob(app.id)
    expect(await markInitialNaisHistorySynced(app.id, jobId)).toBe(true)
    const firstCompletion = await getMonitoredApplicationById(app.id)
    expect(firstCompletion?.initial_nais_history_synced_at).toBeInstanceOf(Date)

    expect(await markInitialNaisHistorySynced(app.id, jobId)).toBe(true)
    const secondCompletion = await getMonitoredApplicationById(app.id)
    expect(secondCompletion?.initial_nais_history_synced_at).toEqual(firstCompletion?.initial_nais_history_synced_at)
  })

  it('throws when the monitored application does not exist', async () => {
    await expect(markInitialNaisHistorySynced(-1, -1)).rejects.toThrow('Monitored application not found: -1')
  })
})

describe('Nais history recovery', () => {
  it('lists active completed apps with latest NAIS sync details and filters by identity', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-recovery',
      environment_name: 'prod-gcp',
      app_name: 'recovery-app',
    })
    const jobId = await createActiveNaisSyncJob(app.id)
    expect(await markInitialNaisHistorySynced(app.id, jobId)).toBe(true)
    await pool.query(
      `UPDATE sync_jobs
       SET status = 'completed', options = $2, result = $3, completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [jobId, JSON.stringify({ version: 'test-version' }), JSON.stringify({ initialHistorySyncStatus: 'completed' })],
    )

    const candidates = await getNaisHistoryRecoveryCandidates('recovery-app')

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      id: app.id,
      latest_sync_status: 'completed',
      latest_sync_version: 'test-version',
      latest_sync_is_active: false,
    })
    expect(await getNaisHistoryRecoveryCandidates('no-match')).toEqual([])
    expect(await getNaisHistoryRecoveryCandidates('recovery_app')).toEqual([])
    expect(await getNaisHistoryRecoveryCandidates('recovery%')).toEqual([])
  })

  it('does not reset a marker during a running NAIS sync and resets it after completion', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-recovery',
      environment_name: 'prod-gcp',
      app_name: 'running-recovery-app',
    })
    const completedJobId = await createActiveNaisSyncJob(app.id)
    expect(await markInitialNaisHistorySynced(app.id, completedJobId)).toBe(true)
    await pool.query("UPDATE sync_jobs SET status = 'completed' WHERE id = $1", [completedJobId])
    const job = await pool.query<{ id: number }>(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, lock_expires_at)
       VALUES ('nais_sync', $1, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
       RETURNING id`,
      [app.id],
    )

    const candidates = await getNaisHistoryRecoveryCandidates('running-recovery-app')
    expect(candidates[0].latest_sync_is_active).toBe(true)
    expect(await resetNaisHistorySyncMarker(app.id)).toBe('sync_running')

    await pool.query("UPDATE sync_jobs SET status = 'completed' WHERE id = $1", [job.rows[0].id])
    expect(await resetNaisHistorySyncMarker(app.id)).toBe('reset')
    expect((await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at).toBeNull()
  })

  it('serializes marker reset with concurrent Nais sync-lock acquisition', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-recovery',
      environment_name: 'prod-gcp',
      app_name: 'concurrent-recovery-app',
    })
    const completedJobId = await createActiveNaisSyncJob(app.id)
    expect(await markInitialNaisHistorySynced(app.id, completedJobId)).toBe(true)
    await pool.query(
      `UPDATE sync_jobs
       SET status = 'completed', started_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
       WHERE id = $1`,
      [completedJobId],
    )
    const initialMarker = (await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at
    const client = await pool.connect()
    let transactionOpen = false

    try {
      await client.query('BEGIN')
      transactionOpen = true
      await lockMonitoredAppSync(client, app.id)

      let resetFinished = false
      let lockAcquisitionFinished = false
      const resetPromise = resetNaisHistorySyncMarker(app.id).finally(() => {
        resetFinished = true
      })
      const lockPromise = acquireSyncLock('nais_sync', app.id).finally(() => {
        lockAcquisitionFinished = true
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      const operationsWereBlocked = !resetFinished && !lockAcquisitionFinished
      await client.query('COMMIT')
      transactionOpen = false

      const [resetResult, lockId] = await Promise.all([resetPromise, lockPromise])
      expect(operationsWereBlocked).toBe(true)
      expect(lockId).toEqual(expect.any(Number))
      expect(['reset', 'sync_running']).toContain(resetResult)

      const markerAfterRace = (await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at
      if (resetResult === 'reset') {
        expect(markerAfterRace).toBeNull()
      } else {
        expect(markerAfterRace).toEqual(initialMarker)
      }

      if (typeof lockId === 'number') {
        await releaseSyncLock(lockId, 'completed')
      }
    } finally {
      if (transactionOpen) await client.query('ROLLBACK')
      client.release()
    }
  })

  it('releases an expired Nais sync lock before resetting the marker', async () => {
    const app = await createMonitoredApplication({
      team_slug: 'team-recovery',
      environment_name: 'prod-gcp',
      app_name: 'expired-recovery-app',
    })
    const completedJobId = await createActiveNaisSyncJob(app.id)
    expect(await markInitialNaisHistorySynced(app.id, completedJobId)).toBe(true)
    await pool.query("UPDATE sync_jobs SET status = 'completed' WHERE id = $1", [completedJobId])
    const job = await pool.query<{ id: number }>(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, lock_expires_at)
       VALUES ('nais_sync', $1, 'running', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '1 minute')
       RETURNING id`,
      [app.id],
    )

    const candidates = await getNaisHistoryRecoveryCandidates('expired-recovery-app')
    expect(candidates[0].latest_sync_is_active).toBe(false)
    expect(await resetNaisHistorySyncMarker(app.id)).toBe('reset')
    expect((await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at).toBeNull()
    expect(await markInitialNaisHistorySynced(app.id, job.rows[0].id)).toBe(false)
    expect((await getMonitoredApplicationById(app.id))?.initial_nais_history_synced_at).toBeNull()
    const expiredJob = await pool.query<{ status: string }>('SELECT status FROM sync_jobs WHERE id = $1', [
      job.rows[0].id,
    ])
    expect(expiredJob.rows[0].status).toBe('failed')
  })
})

describe('getNaisHistoryRiskApps', () => {
  it('flags collisions and markers without a covering completed job across all history', async () => {
    const collided = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'collided-app',
    })
    const unbacked = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'unbacked-app',
    })
    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, completed_at, error)
       VALUES ('nais_sync', $1, 'failed', '2020-01-14T12:00:00Z', '2020-01-14T12:01:00Z',
               'Nais deployment ID x could not be inserted or found for monitored application 1')`,
      [collided.id],
    )
    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, completed_at)
       VALUES ('nais_sync', $1, 'completed', '2020-01-14T12:00:00Z', '2020-01-14T12:01:00Z')`,
      [unbacked.id],
    )
    await pool.query(
      `UPDATE monitored_applications SET initial_nais_history_synced_at = '2020-01-14T13:00:00Z' WHERE id = $1`,
      [unbacked.id],
    )

    const apps = await getNaisHistoryRiskApps()
    const byName = Object.fromEntries(apps.map((app) => [app.app_name, app]))

    expect(byName['collided-app']).toMatchObject({
      id_collision: true,
      failed_since_last_completed: 1,
      completed_syncs: 0,
    })
    expect(byName['unbacked-app']).toMatchObject({ marker_without_completed_job: true, completed_syncs: 1 })
  })

  it('does not flag markers whose job history has been pruned', async () => {
    const pruned = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'pruned-app',
    })
    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, completed_at)
       VALUES ('nais_sync', $1, 'completed', '2020-03-01T12:00:00Z', '2020-03-01T12:01:00Z')`,
      [pruned.id],
    )
    await pool.query(
      `UPDATE monitored_applications SET initial_nais_history_synced_at = '2020-01-14T13:00:00Z' WHERE id = $1`,
      [pruned.id],
    )

    const apps = await getNaisHistoryRiskApps()

    expect(apps.find((app) => app.app_name === 'pruned-app')?.marker_without_completed_job ?? false).toBe(false)
  })

  it('clears the collision flag once the history marker is newer than the collision failure', async () => {
    const recovered = await createMonitoredApplication({
      team_slug: 'team-a',
      environment_name: 'prod-gcp',
      app_name: 'recovered-app',
    })
    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, completed_at, error)
       VALUES ('nais_sync', $1, 'failed', '2020-01-14T12:00:00Z', '2020-01-14T12:01:00Z',
               'Nais deployment ID x is already stored for a different monitored application')`,
      [recovered.id],
    )
    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, completed_at)
       VALUES ('nais_sync', $1, 'completed', '2020-01-15T12:00:00Z', '2020-01-15T12:01:00Z')`,
      [recovered.id],
    )
    await pool.query(
      `UPDATE monitored_applications SET initial_nais_history_synced_at = '2020-01-15T12:00:30Z' WHERE id = $1`,
      [recovered.id],
    )

    const apps = await getNaisHistoryRiskApps()

    expect(apps.find((app) => app.app_name === 'recovered-app')?.id_collision ?? false).toBe(false)
  })
})
