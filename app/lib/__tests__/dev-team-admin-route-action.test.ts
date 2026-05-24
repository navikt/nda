import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockGetDevTeamBySlug,
  mockResolveTeamAdminCapabilities,
  mockGetApplicationInfo,
  mockGetRepositoryDefaultBranch,
  mockCreateMonitoredApplication,
  mockUpdateImplicitApprovalSettings,
  mockClientQuery,
  mockClientRelease,
  mockPoolConnect,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockGetDevTeamBySlug: vi.fn(),
  mockResolveTeamAdminCapabilities: vi.fn(),
  mockGetApplicationInfo: vi.fn(),
  mockGetRepositoryDefaultBranch: vi.fn(),
  mockCreateMonitoredApplication: vi.fn(),
  mockUpdateImplicitApprovalSettings: vi.fn(),
  mockClientQuery: vi.fn(),
  mockClientRelease: vi.fn(),
  mockPoolConnect: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/db/dev-teams.server', () => ({
  getDevTeamBySlug: mockGetDevTeamBySlug,
  addNaisTeamToDevTeam: vi.fn(),
  getDevTeamApplications: vi.fn(),
  removeAppFromDevTeam: vi.fn(),
  removeNaisTeamFromDevTeam: vi.fn(),
  updateDevTeam: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  canAssignTeamRole: vi.fn(),
  resolveTeamAdminCapabilities: mockResolveTeamAdminCapabilities,
}))

vi.mock('~/lib/nais.server', () => ({
  fetchAllTeamsAndApplications: vi.fn(),
  getApplicationInfo: mockGetApplicationInfo,
}))

vi.mock('~/lib/github/git.server', () => ({
  getRepositoryDefaultBranch: mockGetRepositoryDefaultBranch,
}))

vi.mock('~/db/monitored-applications.server', () => ({
  createMonitoredApplication: mockCreateMonitoredApplication,
  getAllMonitoredApplications: vi.fn(),
}))

vi.mock('~/db/app-settings.server', () => ({
  updateImplicitApprovalSettings: mockUpdateImplicitApprovalSettings,
}))

vi.mock('~/db/connection.server', () => ({
  pool: {
    connect: mockPoolConnect,
  },
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { action } from '../../routes/sections.$sectionSlug.teams.$devTeamSlug.admin'

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/sections/pensjon/teams/starte-pensjon/admin', {
    method: 'POST',
    body: formData,
  })
}

describe('sections team admin action - add_apps characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetDevTeamBySlug.mockResolvedValue({
      id: 10,
      section_slug: 'pensjon',
      is_active: true,
    })
    mockResolveTeamAdminCapabilities.mockResolvedValue({ canAdmin: true })
    mockGetApplicationInfo.mockResolvedValue({
      name: 'pensjon-api',
      team: 'pensjondeployer',
      environment: 'prod-gcp',
      repository: 'https://github.com/navikt/pensjon-api',
    })
    mockGetRepositoryDefaultBranch.mockResolvedValue('main')

    mockClientQuery.mockResolvedValue({ rows: [] })
    mockClientRelease.mockImplementation(() => {})
    mockPoolConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    })

    mockCreateMonitoredApplication.mockResolvedValue({ id: 101 })
    mockUpdateImplicitApprovalSettings.mockResolvedValue({})
  })

  it('returns validation error for invalid implicit mode when creating new apps', async () => {
    const formData = new FormData()
    formData.set('intent', 'add_apps')
    formData.append('app_ref', 'new:pensjondeployer|prod-gcp|pensjon-api')
    formData.set('audit_start_year', '2025')
    formData.set('implicit_approval_mode', 'invalid_mode')

    const result = await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(result).toEqual({ error: 'Ugyldig modus for implisitt godkjenning.' })
    expect(mockPoolConnect).not.toHaveBeenCalled()
  })

  it('adds existing and new apps and applies implicit approval settings to new ones', async () => {
    const formData = new FormData()
    formData.set('intent', 'add_apps')
    formData.append('app_ref', 'id:42')
    formData.append('app_ref', 'new:pensjondeployer|prod-gcp|pensjon-api')
    formData.set('audit_start_year', '2025')
    formData.set('implicit_approval_mode', 'dependabot_only')

    const result = await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(mockCreateMonitoredApplication).toHaveBeenCalledWith(
      {
        team_slug: 'pensjondeployer',
        environment_name: 'prod-gcp',
        app_name: 'pensjon-api',
        audit_start_year: 2025,
        default_branch: 'main',
      },
      expect.objectContaining({ query: mockClientQuery, release: mockClientRelease }),
    )

    const insertCalls = mockClientQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO dev_team_applications'),
    )
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('INSERT INTO dev_team_applications'), [10, 42]],
        [expect.stringContaining('INSERT INTO dev_team_applications'), [10, 101]],
      ]),
    )

    expect(mockUpdateImplicitApprovalSettings).toHaveBeenCalledTimes(1)
    expect(mockUpdateImplicitApprovalSettings).toHaveBeenCalledWith({
      monitoredAppId: 101,
      settings: { mode: 'dependabot_only' },
      changedByNavIdent: 'Z990010',
      changedByName: 'Rask Elv',
    })

    expect(mockClientRelease).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: 'La til 2 applikasjoner (1 ny app lagt til overvåking).',
    })
  })
})
