import { describe, expect, it } from 'vitest'
import { mergeAppCardsByRepo } from '../merge-app-cards-by-repo'

describe('mergeAppCardsByRepo', () => {
  function makeRepoApp(overrides: {
    id: number
    environment_name: string
    app_name?: string
    active_repo?: string | null
    repository_id?: number | null
    without_four_eyes?: number
    alertCount?: number
  }) {
    return {
      id: overrides.id,
      team_slug: 'team-a',
      environment_name: overrides.environment_name,
      app_name: overrides.app_name ?? 'my-app',
      active_repo: overrides.active_repo ?? null,
      repository_id: overrides.repository_id,
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
    const result = mergeAppCardsByRepo(apps)
    expect(result).toHaveLength(2)
  })

  it('merges apps sharing the same active repo into one card', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/monorepo' }),
    ]
    const result = mergeAppCardsByRepo(apps)
    expect(result).toHaveLength(1)
    expect(result[0].siblingEnvironments).toEqual(['prod-fss'])
  })

  it('does not assign a repository ID to cards with mixed repository identities', () => {
    const apps = [
      makeRepoApp({
        id: 1,
        environment_name: 'prod-gcp',
        active_repo: 'navikt/reused-name',
        repository_id: 216,
      }),
      makeRepoApp({
        id: 2,
        environment_name: 'prod-fss',
        active_repo: 'navikt/reused-name',
        repository_id: 217,
      }),
    ]
    const result = mergeAppCardsByRepo(apps)

    expect(result).toHaveLength(1)
    expect(result[0].repository_id).toBeNull()
  })

  it('keeps the shared repository ID when merging apps with the same repository identity', () => {
    const apps = [
      makeRepoApp({
        id: 1,
        environment_name: 'prod-gcp',
        active_repo: 'navikt/monorepo',
        repository_id: 216,
      }),
      makeRepoApp({
        id: 2,
        environment_name: 'prod-fss',
        active_repo: 'navikt/monorepo',
        repository_id: 216,
      }),
    ]
    const result = mergeAppCardsByRepo(apps)

    expect(result).toHaveLength(1)
    expect(result[0].repository_id).toBe(216)
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
    const result = mergeAppCardsByRepo(apps)
    expect(result[0].stats.without_four_eyes).toBe(5)
    expect(result[0].stats.total).toBe(20)
    expect(result[0].alertCount).toBe(3)
  })

  it('does not merge apps with different active repos', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/repo-a' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/repo-b' }),
    ]
    const result = mergeAppCardsByRepo(apps)
    expect(result).toHaveLength(2)
  })

  it('keeps a single-app repo without siblingEnvironments', () => {
    const apps = [makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/solo-repo' })]
    const result = mergeAppCardsByRepo(apps)
    expect(result).toHaveLength(1)
    expect(result[0].siblingEnvironments).toBeUndefined()
  })

  it('mixes repo-sharing and standalone apps', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 3, environment_name: 'dev-gcp' }),
    ]
    const result = mergeAppCardsByRepo(apps)
    expect(result).toHaveLength(2)
    const grouped = result.find((r) => r.siblingEnvironments)
    const standalone = result.find((r) => !r.siblingEnvironments)
    expect(grouped).toBeDefined()
    expect(standalone?.id).toBe(3)
  })

  it('sets repoApps with all member app info when repo has multiple apps', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', app_name: 'pensjon-psak', active_repo: 'navikt/monorepo' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', app_name: 'pensjon-penny', active_repo: 'navikt/monorepo' }),
    ]
    const result = mergeAppCardsByRepo(apps)
    expect(result[0].repoApps).toEqual([
      { app_name: 'pensjon-psak', environment_name: 'prod-gcp' },
      { app_name: 'pensjon-penny', environment_name: 'prod-fss' },
    ])
  })

  it('does not set repoApps on standalone apps', () => {
    const apps = [makeRepoApp({ id: 1, environment_name: 'prod-gcp' })]
    const result = mergeAppCardsByRepo(apps)
    expect(result[0].repoApps).toBeUndefined()
  })

  it('sets repoDisplayName to the active repo when apps share a repo', () => {
    const apps = [
      makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/pensjon-alde' }),
      makeRepoApp({ id: 2, environment_name: 'prod-fss', active_repo: 'navikt/pensjon-alde' }),
    ]
    const result = mergeAppCardsByRepo(apps)
    expect(result[0].repoDisplayName).toBe('navikt/pensjon-alde')
  })

  it('does not set repoDisplayName on standalone apps', () => {
    const apps = [makeRepoApp({ id: 1, environment_name: 'prod-gcp', active_repo: 'navikt/solo-repo' })]
    const result = mergeAppCardsByRepo(apps)
    expect(result[0].repoDisplayName).toBeUndefined()
  })
})
