import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createMonitoredApplication,
  getMonitoredApplicationById,
  markInitialNaisHistorySynced,
  updateMonitoredApplication,
} from '../../monitored-applications.server'
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
