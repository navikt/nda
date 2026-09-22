import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveRepositoryFromParams,
  mockGetUserIdentity,
  mockResolveRepositoryAdminAccess,
  mockGetAffectedAppsForRepositoryId,
  mockGetAllAppsLinkedToRepositoryId,
  mockGetEffectiveSettingsForApps,
  mockGetRepositoryDeploymentStats,
} = vi.hoisted(() => ({
  mockResolveRepositoryFromParams: vi.fn(),
  mockGetUserIdentity: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetAffectedAppsForRepositoryId: vi.fn(),
  mockGetAllAppsLinkedToRepositoryId: vi.fn(),
  mockGetEffectiveSettingsForApps: vi.fn(),
  mockGetRepositoryDeploymentStats: vi.fn(),
}))

vi.mock('~/lib/repository-resolution.server', () => ({
  resolveRepositoryFromParams: mockResolveRepositoryFromParams,
}))

vi.mock('~/lib/auth.server', () => ({
  getUserIdentity: mockGetUserIdentity,
}))

vi.mock('~/lib/authorization.server', () => ({
  resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess,
}))

vi.mock('~/db/repositories.server', () => ({
  getAffectedAppsForRepositoryId: mockGetAffectedAppsForRepositoryId,
  getAllAppsLinkedToRepositoryId: mockGetAllAppsLinkedToRepositoryId,
  getEffectiveSettingsForApps: mockGetEffectiveSettingsForApps,
}))

vi.mock('~/db/deployments.server', () => ({
  getRepositoryDeploymentStats: mockGetRepositoryDeploymentStats,
}))

import { loader } from './repository.$owner.$repo'

const repository = {
  id: 5,
  github_repo_id: '123',
  github_owner: 'navikt',
  github_repo_name: 'some-repo',
  audit_start_year: 2022,
  implicit_approval_mode: 'off' as const,
  default_branch: 'main',
  default_branch_synced_at: null,
}

const linkedApp = {
  id: 1,
  app_name: 'repo-app',
  team_slug: 'nais-repo-app',
  environment_name: 'prod-gcp',
  is_active: true,
}

const emptyStats = {
  total: 0,
  with_four_eyes: 0,
  without_four_eyes: 0,
  pending_verification: 0,
  missing_goal_links: 0,
  baseline_action_count: 0,
  last_deployment: null,
  last_deployment_id: null,
  four_eyes_percentage: 0,
}

function makeArgs(search = '') {
  const url = new URL(`http://localhost/repository/navikt/some-repo${search}`)
  return { params: { owner: 'navikt', repo: 'some-repo' }, request: new Request(url), url } as never
}

describe('repository root loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockGetUserIdentity.mockResolvedValue(null)
    mockGetAffectedAppsForRepositoryId.mockResolvedValue([])
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([])
    mockGetEffectiveSettingsForApps.mockResolvedValue(new Map())
    mockGetRepositoryDeploymentStats.mockResolvedValue(emptyStats)
  })

  it('defaults to last-week period and passes no apps to stats when nothing is linked', async () => {
    const result = await loader(makeArgs())

    expect(result.period).toBe('last-week')
    expect(mockGetRepositoryDeploymentStats).toHaveBeenCalledWith([], expect.any(Date), expect.any(Date))
    expect(result.deploymentStats).toBe(emptyStats)
  })

  it('uses the period from the query string', async () => {
    const result = await loader(makeArgs('?period=last-month'))

    expect(result.period).toBe('last-month')
  })

  it('resolves effective audit start year per linked app and forwards it to the stats query', async () => {
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([linkedApp])
    mockGetEffectiveSettingsForApps.mockResolvedValue(
      new Map([
        [
          linkedApp.id,
          { repositoryId: 5, auditStartYear: 2021, implicitApprovalSettings: { mode: 'off' }, defaultBranch: null },
        ],
      ]),
    )

    await loader(makeArgs())

    expect(mockGetRepositoryDeploymentStats).toHaveBeenCalledWith(
      [{ id: linkedApp.id, audit_start_year: 2021 }],
      expect.any(Date),
      expect.any(Date),
    )
  })

  it('falls back to unauthenticated affected-apps lookup when there is no identity', async () => {
    mockGetAffectedAppsForRepositoryId.mockResolvedValue([
      { id: 1, app_name: 'a', team_slug: 't', environment_name: 'e' },
    ])

    const result = await loader(makeArgs())

    expect(mockResolveRepositoryAdminAccess).not.toHaveBeenCalled()
    expect(result.canAccessAdmin).toBe(false)
    expect(result.affectedApps).toHaveLength(1)
  })
})
