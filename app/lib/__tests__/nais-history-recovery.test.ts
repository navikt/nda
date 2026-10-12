import { describe, expect, it } from 'vitest'
import { type NaisHistoryRiskApp, partitionNaisHistoryRisks } from '../nais-history-recovery'

function makeApp(overrides: Partial<NaisHistoryRiskApp>): NaisHistoryRiskApp {
  return {
    app_id: 1,
    team_slug: 'team-a',
    environment_name: 'prod-gcp',
    app_name: 'app-a',
    initial_nais_history_synced_at: new Date('2026-01-14T12:00:00Z'),
    completed_syncs: 1,
    failed_since_last_completed: 0,
    last_completed_at: new Date('2026-01-14T12:00:00Z'),
    last_error: null,
    id_collision: false,
    marker_without_completed_job: false,
    deployment_count: 10,
    ...overrides,
  }
}

describe('partitionNaisHistoryRisks', () => {
  it('puts apps a resync can fix in the resync group', () => {
    const { resync, investigate } = partitionNaisHistoryRisks([
      makeApp({ app_id: 1, marker_without_completed_job: true }),
      makeApp({ app_id: 2, initial_nais_history_synced_at: null }),
      makeApp({ app_id: 3, failed_since_last_completed: 2 }),
    ])

    expect(resync.map((item) => item.app.app_id)).toEqual([1, 2, 3])
    expect(investigate).toEqual([])
  })

  it('puts collisions and apps without deployments in the investigate group', () => {
    const { resync, investigate } = partitionNaisHistoryRisks([
      makeApp({ app_id: 1, id_collision: true, failed_since_last_completed: 1 }),
      makeApp({ app_id: 2, deployment_count: 0 }),
    ])

    expect(resync).toEqual([])
    expect(investigate.map((item) => item.app.app_id)).toEqual([1, 2])
    expect(investigate[0].needsResync).toEqual([])
  })

  it('keeps an app with both kinds of risk in the investigate group only', () => {
    const { resync, investigate } = partitionNaisHistoryRisks([
      makeApp({ app_id: 1, marker_without_completed_job: true, deployment_count: 0 }),
    ])

    expect(resync).toEqual([])
    expect(investigate).toHaveLength(1)
    expect(investigate[0].needsResync).toEqual(['Markør satt uten fullført synkjobb'])
  })

  it('ignores healthy apps', () => {
    const { resync, investigate } = partitionNaisHistoryRisks([makeApp({})])

    expect(resync).toEqual([])
    expect(investigate).toEqual([])
  })
})
