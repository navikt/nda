import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireAppAdminAccess,
  mockCanAccessRepositorySettingsAdmin,
  mockResolveRepositoryAdminAccess,
  mockGetEffectiveSettingsForApp,
  mockGetRepositoryById,
  mockGetAppConfigAuditLog,
  mockGetAuditReportsForAppAdmin,
  mockGetLatestSyncJob,
  mockGetGitHubDataStatsForApp,
  mockGetUsersByIdentifiers,
} = vi.hoisted(() => ({
  mockRequireAppAdminAccess: vi.fn(),
  mockCanAccessRepositorySettingsAdmin: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetEffectiveSettingsForApp: vi.fn(),
  mockGetRepositoryById: vi.fn(),
  mockGetAppConfigAuditLog: vi.fn(),
  mockGetAuditReportsForAppAdmin: vi.fn(),
  mockGetLatestSyncJob: vi.fn(),
  mockGetGitHubDataStatsForApp: vi.fn(),
  mockGetUsersByIdentifiers: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  requireAppAdminAccess: mockRequireAppAdminAccess,
  canAccessRepositorySettingsAdmin: mockCanAccessRepositorySettingsAdmin,
  resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess,
}))

vi.mock('~/db/app-settings.server', () => ({
  getAppConfigAuditLog: mockGetAppConfigAuditLog,
}))

vi.mock('~/db/repositories.server', () => ({
  getEffectiveSettingsForApp: mockGetEffectiveSettingsForApp,
  getRepositoryById: mockGetRepositoryById,
}))

vi.mock('~/db/audit-reports.server', () => ({
  getAuditReportsForAppAdmin: mockGetAuditReportsForAppAdmin,
}))

vi.mock('~/db/github-data.server', () => ({
  getGitHubDataStatsForApp: mockGetGitHubDataStatsForApp,
}))

vi.mock('~/db/sync-jobs.server', () => ({
  getLatestSyncJob: mockGetLatestSyncJob,
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getAllUsersWithAccounts: vi.fn(),
  getUsersByIdentifiers: mockGetUsersByIdentifiers,
}))

vi.mock('./$team.env.$env.app.$app.admin.actions.server', () => ({
  action: vi.fn(),
}))

import { loader } from './$team.env.$env.app.$app.admin'

function makeRequest(): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin')
}

const params = { team: 'pensjondeployer', env: 'prod-fss', app: 'pensjon-pen' }

describe('admin loader - scoped user lookups (no org-wide directory leak)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAppAdminAccess.mockResolvedValue({
      user: { navIdent: 'Z990010', name: 'Rask Elv' },
      app: { id: 1, environment_name: 'prod-fss', audit_start_year: 2024 },
    })
    mockGetEffectiveSettingsForApp.mockResolvedValue({
      repositoryId: null,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })
    mockCanAccessRepositorySettingsAdmin.mockResolvedValue(false)
    mockGetRepositoryById.mockResolvedValue(null)
    mockGetAppConfigAuditLog.mockResolvedValue([])
    mockGetLatestSyncJob.mockResolvedValue(null)
    mockGetGitHubDataStatsForApp.mockResolvedValue(null)
    mockGetUsersByIdentifiers.mockResolvedValue(new Map())
  })

  it("only looks up nav_idents referenced by this app's audit reports, not the entire org", async () => {
    mockGetAuditReportsForAppAdmin.mockResolvedValue([
      { id: 1, archived_by: 'Z990001', superseded_by: null },
      { id: 2, archived_by: null, superseded_by: 'Z990002' },
      { id: 3, archived_by: 'Z990001', superseded_by: 'Z990002' },
      { id: 4, archived_by: null, superseded_by: null },
    ])

    await loader({ params, request: makeRequest() } as never)

    expect(mockGetUsersByIdentifiers).toHaveBeenCalledTimes(1)
    const calledWith = mockGetUsersByIdentifiers.mock.calls[0][0] as string[]
    expect(new Set(calledWith)).toEqual(new Set(['Z990001', 'Z990002']))
  })

  it('builds displayNameMap only from the scoped lookup result', async () => {
    mockGetAuditReportsForAppAdmin.mockResolvedValue([{ id: 1, archived_by: 'Z990001', superseded_by: null }])
    mockGetUsersByIdentifiers.mockResolvedValue(
      new Map([['Z990001', { nav_ident: 'Z990001', display_name: 'Glad Fjord' }]]),
    )

    const result = await loader({ params, request: makeRequest() } as never)

    expect(result.displayNameMap).toEqual({ Z990001: 'Glad Fjord' })
  })

  it('does not query users at all when no audit reports reference any nav_ident', async () => {
    mockGetAuditReportsForAppAdmin.mockResolvedValue([])

    await loader({ params, request: makeRequest() } as never)

    expect(mockGetUsersByIdentifiers).toHaveBeenCalledWith([])
  })

  it('checks canAccessAppAdmin before any admin data is fetched', async () => {
    mockRequireAppAdminAccess.mockRejectedValue(new Response('Forbidden - admin access required', { status: 403 }))

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetAuditReportsForAppAdmin).not.toHaveBeenCalled()
    expect(mockGetUsersByIdentifiers).not.toHaveBeenCalled()
  })
})

describe('admin loader - repository-admin capability gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAppAdminAccess.mockResolvedValue({
      user: { navIdent: 'Z990010', name: 'Rask Elv' },
      app: { id: 1, environment_name: 'prod-fss', audit_start_year: 2024 },
    })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })
    mockCanAccessRepositorySettingsAdmin.mockResolvedValue(false)
    mockGetAppConfigAuditLog.mockResolvedValue([])
    mockGetAuditReportsForAppAdmin.mockResolvedValue([])
    mockGetLatestSyncJob.mockResolvedValue(null)
    mockGetGitHubDataStatsForApp.mockResolvedValue(null)
    mockGetUsersByIdentifiers.mockResolvedValue(new Map())
  })

  it('exposes canAccessRepoAdminPage as false when the app has no linked repository', async () => {
    mockGetEffectiveSettingsForApp.mockResolvedValue({
      repositoryId: null,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(mockGetRepositoryById).not.toHaveBeenCalled()
    expect(mockResolveRepositoryAdminAccess).not.toHaveBeenCalled()
    expect(result.canAccessRepoAdminPage).toBe(false)
    expect(result.hasRepository).toBe(false)
    expect(result.repository).toBeNull()
  })

  it('exposes canAccessRepoAdminPage as true when the user is authorized for the linked repository', async () => {
    mockGetEffectiveSettingsForApp.mockResolvedValue({
      repositoryId: 5,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [] })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(mockResolveRepositoryAdminAccess).toHaveBeenCalledWith(expect.anything(), 5)
    expect(result.canAccessRepoAdminPage).toBe(true)
    expect(result.hasRepository).toBe(true)
    expect(result.repository).toEqual({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
  })

  it('exposes canAccessRepoAdminPage as false when the user lacks admin access to the linked repository', async () => {
    mockGetEffectiveSettingsForApp.mockResolvedValue({
      repositoryId: 5,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(mockResolveRepositoryAdminAccess).toHaveBeenCalledWith(expect.anything(), 5)
    expect(result.canAccessRepoAdminPage).toBe(false)
    expect(result.hasRepository).toBe(true)
    expect(result.repository).toBeNull()
  })

  it('does not expose affectedAppCount (other apps in the repo) when the user lacks repo admin access', async () => {
    mockGetEffectiveSettingsForApp.mockResolvedValue({
      repositoryId: 5,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockResolveRepositoryAdminAccess.mockResolvedValue({
      authorized: false,
      affectedApps: [{ id: 2, app_name: 'other-app', team_slug: 'other-team', environment_name: 'prod-fss' }],
    })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(result.affectedAppCount).toEqual(0)
  })

  it('exposes affectedAppCount from the same authorized snapshot when the user is authorized for the linked repository', async () => {
    mockGetEffectiveSettingsForApp.mockResolvedValue({
      repositoryId: 5,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockResolveRepositoryAdminAccess.mockResolvedValue({
      authorized: true,
      affectedApps: [
        { id: 2, app_name: 'other-app', team_slug: 'other-team', environment_name: 'prod-fss' },
        { id: 3, app_name: 'third-app', team_slug: 'third-team', environment_name: 'prod-fss' },
      ],
    })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(mockResolveRepositoryAdminAccess).toHaveBeenCalledWith(expect.anything(), 5)
    expect(result.affectedAppCount).toEqual(2)
  })
})
