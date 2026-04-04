import { describe, expect, it } from 'vitest'
import { groupAppCards } from '../group-app-cards'

function makeApp(overrides: {
  id: number
  environment_name: string
  application_group_id?: number | null
  without_four_eyes?: number
  alertCount?: number
}) {
  return {
    id: overrides.id,
    team_slug: 'team-a',
    environment_name: overrides.environment_name,
    app_name: 'my-app',
    active_repo: null,
    application_group_id: overrides.application_group_id ?? null,
    stats: {
      total: 10,
      without_four_eyes: overrides.without_four_eyes ?? 0,
      pending_verification: 0,
    },
    alertCount: overrides.alertCount ?? 0,
  }
}

describe('groupAppCards', () => {
  it('returns ungrouped apps as-is', () => {
    const apps = [makeApp({ id: 1, environment_name: 'prod-gcp' }), makeApp({ id: 2, environment_name: 'prod-fss' })]
    const result = groupAppCards(apps)
    expect(result).toHaveLength(2)
  })

  it('merges apps in the same group into one card', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 42 }),
    ]
    const result = groupAppCards(apps)
    expect(result).toHaveLength(1)
    expect(result[0].siblingEnvironments).toEqual(['prod-fss'])
  })

  it('aggregates stats across grouped apps', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42, without_four_eyes: 3, alertCount: 1 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 42, without_four_eyes: 2, alertCount: 2 }),
    ]
    const result = groupAppCards(apps)
    expect(result[0].stats.without_four_eyes).toBe(5)
    expect(result[0].stats.total).toBe(20)
    expect(result[0].alertCount).toBe(3)
  })

  it('does not merge apps with different group IDs', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 1 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 2 }),
    ]
    const result = groupAppCards(apps)
    expect(result).toHaveLength(2)
  })

  it('keeps a single-app group without siblingEnvironments', () => {
    const apps = [makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42 })]
    const result = groupAppCards(apps)
    expect(result).toHaveLength(1)
    expect(result[0].siblingEnvironments).toBeUndefined()
  })

  it('mixes grouped and ungrouped apps', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 42 }),
      makeApp({ id: 3, environment_name: 'dev-gcp' }),
    ]
    const result = groupAppCards(apps)
    expect(result).toHaveLength(2)
    const grouped = result.find((r) => r.siblingEnvironments)
    const ungrouped = result.find((r) => !r.siblingEnvironments)
    expect(grouped).toBeDefined()
    expect(ungrouped?.id).toBe(3)
  })
})
