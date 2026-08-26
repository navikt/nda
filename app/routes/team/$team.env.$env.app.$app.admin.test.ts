import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockGetMonitoredApplicationByIdentity,
  mockCanAccessAppAdmin,
  mockGetImplicitApprovalSettings,
  mockGetAppConfigAuditLog,
  mockGetAuditReportsForAppAdmin,
  mockGetLatestSyncJob,
  mockGetGitHubDataStatsForApp,
  mockGetUsersByIdentifiers,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockGetMonitoredApplicationByIdentity: vi.fn(),
  mockCanAccessAppAdmin: vi.fn(),
  mockGetImplicitApprovalSettings: vi.fn(),
  mockGetAppConfigAuditLog: vi.fn(),
  mockGetAuditReportsForAppAdmin: vi.fn(),
  mockGetLatestSyncJob: vi.fn(),
  mockGetGitHubDataStatsForApp: vi.fn(),
  mockGetUsersByIdentifiers: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/authorization.server', () => ({
  canAccessAppAdmin: mockCanAccessAppAdmin,
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationByIdentity: mockGetMonitoredApplicationByIdentity,
}))

vi.mock('~/db/app-settings.server', () => ({
  getAppConfigAuditLog: mockGetAppConfigAuditLog,
  getImplicitApprovalSettings: mockGetImplicitApprovalSettings,
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
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetMonitoredApplicationByIdentity.mockResolvedValue({
      id: 1,
      environment_name: 'prod-fss',
      audit_start_year: 2024,
    })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockGetImplicitApprovalSettings.mockResolvedValue(null)
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
    mockCanAccessAppAdmin.mockResolvedValue(false)

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetAuditReportsForAppAdmin).not.toHaveBeenCalled()
    expect(mockGetUsersByIdentifiers).not.toHaveBeenCalled()
  })
})
