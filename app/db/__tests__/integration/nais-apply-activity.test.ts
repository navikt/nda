import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { NaisApplicationUpdatedActivity } from '~/lib/nais.server'
import {
  getNaisApplyActivityEvents,
  markNaisApplyActivitiesMaterialized,
  saveNaisApplyActivityEvents,
} from '../../nais-apply-activity.server'
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

function activity(id: string, createdAt = '2026-10-15T10:00:00Z'): NaisApplicationUpdatedActivity {
  return {
    id,
    createdAt,
    actor: 'Glad Fjord',
    message: 'Updated application',
    resourceName: 'app-a',
    teamSlug: 'team-a',
    environmentName: 'prod-gcp',
    gitHubActorClaims: null,
    changedFields: [{ field: 'spec.image', oldValue: 'old', newValue: 'new' }],
  }
}

async function seedActivities(events: NaisApplicationUpdatedActivity[]): Promise<number> {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  await saveNaisApplyActivityEvents(appId, events)
  return appId
}

describe('incremental Apply activity materialization', () => {
  it('selects only new activities and retries whose delay has expired', async () => {
    const appId = await seedActivities([activity('done'), activity('new'), activity('waiting'), activity('due')])
    await markNaisApplyActivitiesMaterialized(appId, [
      { activityLogId: 'done', sourceIds: ['group-done'], retry: false },
      { activityLogId: 'waiting', sourceIds: ['group-waiting'], retry: true },
      { activityLogId: 'due', sourceIds: ['group-due'], retry: true },
    ])
    await pool.query(
      `UPDATE nais_apply_activity_events SET materialization_retry_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
       WHERE monitored_app_id = $1 AND activity_log_id = 'due'`,
      [appId],
    )

    expect((await getNaisApplyActivityEvents(appId)).map((event) => event.id)).toEqual(['new', 'due'])
    expect(await getNaisApplyActivityEvents(appId, { fullHistory: true })).toHaveLength(4)
    const { rows } = await pool.query(
      `SELECT materialization_retry_at - materialized_at AS delay
       FROM nais_apply_activity_events WHERE monitored_app_id = $1 AND activity_log_id = 'waiting'`,
      [appId],
    )
    expect(rows[0].delay.minutes).toBe(5)
  })

  it('does not requeue duplicate events returned by the polling overlap', async () => {
    const event = activity('existing')
    const appId = await seedActivities([event])
    await markNaisApplyActivitiesMaterialized(appId, [{ activityLogId: event.id, sourceIds: ['group'], retry: false }])

    expect(await saveNaisApplyActivityEvents(appId, [event])).toBe(0)
    expect(await getNaisApplyActivityEvents(appId)).toEqual([])
  })

  it('loads older members only for affected groups and the requested application', async () => {
    const appId = await seedActivities([activity('older', '2026-10-14T10:00:00Z'), activity('unrelated')])
    await markNaisApplyActivitiesMaterialized(appId, [
      { activityLogId: 'older', sourceIds: ['affected', 'another-image'], retry: false },
      { activityLogId: 'unrelated', sourceIds: ['unrelated-group'], retry: false },
    ])
    const otherApp = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    await saveNaisApplyActivityEvents(otherApp, [activity('older')])
    await markNaisApplyActivitiesMaterialized(otherApp, [
      { activityLogId: 'older', sourceIds: ['affected'], retry: false },
    ])
    await saveNaisApplyActivityEvents(appId, [activity('delayed', '2026-10-13T10:00:00Z')])

    expect((await getNaisApplyActivityEvents(appId)).map((event) => event.id)).toEqual(['delayed'])
    const olderMembers = await getNaisApplyActivityEvents(appId, { sourceIds: ['affected'] })
    expect(olderMembers.map((event) => event.id)).toEqual(['older'])
    expect(olderMembers[0].createdAt).toBe('2026-10-14T10:00:00.000Z')
    expect(await getNaisApplyActivityEvents(appId, { sourceIds: [] })).toEqual([])
  })

  it('clears retry state when a group is successfully resolved', async () => {
    const appId = await seedActivities([activity('retry')])
    await markNaisApplyActivitiesMaterialized(appId, [{ activityLogId: 'retry', sourceIds: ['group'], retry: true }])
    await markNaisApplyActivitiesMaterialized(appId, [{ activityLogId: 'retry', sourceIds: ['group'], retry: false }])

    expect(await getNaisApplyActivityEvents(appId)).toEqual([])
    expect(await getNaisApplyActivityEvents(appId, { sourceIds: ['group'] })).toHaveLength(1)
  })

  it('preserves unprocessed activities across failed sync attempts', async () => {
    const appId = await seedActivities([activity('retained')])

    expect((await getNaisApplyActivityEvents(appId)).map((event) => event.id)).toEqual(['retained'])
    expect(await saveNaisApplyActivityEvents(appId, [activity('retained')])).toBe(0)
    expect((await getNaisApplyActivityEvents(appId)).map((event) => event.id)).toEqual(['retained'])
  })
})
