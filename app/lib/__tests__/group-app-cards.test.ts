import { describe, expect, it } from 'vitest'
import { groupAppCards, groupAppCardsByRepo } from '../group-app-cards'

function makeApp(overrides: {
  id: number
  environment_name: string
  app_name?: string
  application_group_id?: number | null
  without_four_eyes?: number
  missing_goal_links?: number
  alertCount?: number
}) {
  return {
    id: overrides.id,
    team_slug: 'team-a',
    environment_name: overrides.environment_name,
    app_name: overrides.app_name ?? 'my-app',
    active_repo: null,
    application_group_id: overrides.application_group_id ?? null,
    stats: {
      total: 10,
      without_four_eyes: overrides.without_four_eyes ?? 0,
      pending_verification: 0,
      missing_goal_links: overrides.missing_goal_links ?? 0,
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

  it('merges missing_goal_links across grouped apps', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42, missing_goal_links: 5 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 42, missing_goal_links: 3 }),
    ]
    const result = groupAppCards(apps)
    expect(result[0].stats.missing_goal_links).toBe(8)
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

  it('sets groupName when groupNames map is provided', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 42 }),
    ]
    const groupNames = new Map([[42, 'psak-og-penny']])
    const result = groupAppCards(apps, groupNames)
    expect(result[0].groupName).toBe('psak-og-penny')
  })

  it('sets groupName on single-app groups when groupNames provided', () => {
    const apps = [makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42 })]
    const groupNames = new Map([[42, 'solo-group']])
    const result = groupAppCards(apps, groupNames)
    expect(result[0].groupName).toBe('solo-group')
  })

  it('sets groupApps with all member app info when group has multiple apps', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', app_name: 'pensjon-psak', application_group_id: 42 }),
      makeApp({ id: 2, environment_name: 'prod-fss', app_name: 'pensjon-penny', application_group_id: 42 }),
    ]
    const result = groupAppCards(apps)
    expect(result[0].groupApps).toEqual([
      { app_name: 'pensjon-psak', environment_name: 'prod-gcp' },
      { app_name: 'pensjon-penny', environment_name: 'prod-fss' },
    ])
  })

  it('does not set groupApps on ungrouped apps', () => {
    const apps = [makeApp({ id: 1, environment_name: 'prod-gcp' })]
    const result = groupAppCards(apps)
    expect(result[0].groupApps).toBeUndefined()
  })

  it('does not set groupName when groupNames map is omitted', () => {
    const apps = [
      makeApp({ id: 1, environment_name: 'prod-gcp', application_group_id: 42 }),
      makeApp({ id: 2, environment_name: 'prod-fss', application_group_id: 42 }),
    ]
    const result = groupAppCards(apps)
    expect(result[0].groupName).toBeUndefined()
  })
})

describe('groupAppCardsByRepo', () => {
  function makeRepoApp(overrides: {
    id: number
    environment_name: string
    app_name?: string
    active_repo?: string | null
    without_four_eyes?: number
    alertCount?: number
  }) {
    return {
      id: overrides.id,
      team_slug: 'team-a',
      environment_name: overrides.environment_name,
      app_name: overrides.app_name ?? 'my-app',
      active_repo: overrides.active_repo ?? null,
      stats: {
        total: 10,
        without_four_eyes: overrides.without_four_eyes ?? 0,
        pending_verification: 0,
      },
      alertCount: overrides.alertCount ?? 0,
    }
  }

  it('returns apps without an active repo as-is', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result).toHaveLength(2)
  })

  it('merges apps sharing the same active repo into one card', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/monorepo' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result).toHaveLength(1)
    expect(result[0].siblingEnvironments).toEqual(['prod-fss'])
  })

  it('aggregates stats and alert counts across repo-sharing apps', () => {
    const apps = [
      makeRepoApp({
        id: 1,
        environment_name: 'prod-gcp',
        active_repo: 'navikt/monorepo',
        without_four_eyes: 3,
        alertCount: 1,
      }),
      makeRepoApp({
        id: 2,
        environment_name: 'prod-fss',
        active_repo: 'navikt/monorepo',
        without_four_eyes: 2,
        alertCount: 2,
      }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result[0].stats.without_four_eyes).toBe(5)
    expect(result[0].stats.total).toBe(20)
    expect(result[0].alertCount).toBe(3)
  })

  it('does not merge apps with different active repos', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/repo-a' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/repo-b' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result).toHaveLength(2)
  })

  it('keeps a single-app repo without siblingEnvironments', () => {
    const apps = [makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/solo-repo' })]
    const result = groupAppCardsByRepo(apps)
    expect(result).toHaveLength(1)
    expect(result[0].siblingEnvironments).toBeUndefined()
  })

  it('mixes repo-sharing and standalone apps', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 3, environment_name: 'dev-gcp' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result).toHaveLength(2)
    const grouped = result.find((r) => r.siblingEnvironments)
    const standalone = result.find((r) => !r.siblingEnvironments)
    expect(grouped).toBeDefined()
    expect(standalone?.id).toBe(3)
  })

  it('sets groupApps with all member app info when repo has multiple apps', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', app_name: 'pensjon-psak', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', app_name: 'pensjon-penny', active_repo: 'navikt/monorepo' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result[0].groupApps).toEqual([
      { app_name: 'pensjon-psak', environment_name: 'prod-gcp' },
      { app_name: 'pensjon-penny', environment_name: 'prod-fss' },
    ])
  })

  it('does not set groupApps on standalone apps', () => {
    const apps = [makeRepoApp({ id: 1, environment_name: 'prod-gcp' })]
    const result = groupAppCardsByRepo(apps)
    expect(result[0].groupApps).toBeUndefined()
  })

  it('does not set groupName since no group naming input exists for repo-based grouping', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/monorepo' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result[0].groupName).toBeUndefined()
  })
})
