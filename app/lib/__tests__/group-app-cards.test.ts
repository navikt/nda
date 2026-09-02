import { describe, expect, it } from 'vitest'
import { groupAppCardsByRepo } from '../group-app-cards'

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

  it('sets groupName to the active repo when apps share a repo', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/pensjon-alde' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/pensjon-alde' }),
    ]
    const result = groupAppCardsByRepo(apps)
    expect(result[0].groupName).toBe('navikt/pensjon-alde')
  })

  it('does not set groupName on standalone apps', () => {
    const apps = [makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/solo-repo' })]
    const result = groupAppCardsByRepo(apps)
    expect(result[0].groupName).toBeUndefined()
  })
})
