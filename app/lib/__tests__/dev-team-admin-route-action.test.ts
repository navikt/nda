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
  mockGetDevTeamMembersWithRoles,
  mockGetOrCreateUserFromGraph,
  mockUpsertUserAndGithubAccount,
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
  mockGetDevTeamMembersWithRoles: vi.fn(),
  mockGetOrCreateUserFromGraph: vi.fn(),
  mockUpsertUserAndGithubAccount: vi.fn(),
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

vi.mock('~/db/role-assignments.server', () => ({
  assignTeamRole: vi.fn(),
  getDevTeamMembersWithRoles: mockGetDevTeamMembersWithRoles,
  getTeamRoleAssignmentById: vi.fn(),
  removeTeamRole: vi.fn(),
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getOrCreateUserFromGraph: mockGetOrCreateUserFromGraph,
  upsertUserAndGithubAccount: mockUpsertUserAndGithubAccount,
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

    expect(mockGetRepositoryDefaultBranch).toHaveBeenCalledWith('navikt', 'pensjon-api')
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

  it('passes null default_branch to createMonitoredApplication when GitHub detection fails', async () => {
    mockGetRepositoryDefaultBranch.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('intent', 'add_apps')
    formData.append('app_ref', 'new:pensjondeployer|prod-gcp|pensjon-api')
    formData.set('audit_start_year', '2025')
    formData.set('implicit_approval_mode', 'dependabot_only')

    await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(mockGetRepositoryDefaultBranch).toHaveBeenCalledWith('navikt', 'pensjon-api')
    expect(mockCreateMonitoredApplication).toHaveBeenCalledWith(
      expect.objectContaining({ default_branch: null }),
      expect.anything(),
    )
  })
})

describe('sections team admin action - link_github', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetDevTeamBySlug.mockResolvedValue({
      id: 10,
      section_slug: 'pensjon',
      is_active: true,
    })
    mockResolveTeamAdminCapabilities.mockResolvedValue({ canAdmin: true })
    mockGetDevTeamMembersWithRoles.mockResolvedValue([
      {
        nav_ident: 'Z990001',
        role: 'utvikler',
        github_username: null,
        display_github_username: null,
        display_name: 'Glad Fjord',
        id: 1,
        assigned_at: new Date(),
      },
    ])
    mockGetOrCreateUserFromGraph.mockResolvedValue({ nav_ident: 'Z990001', display_name: 'Glad Fjord' })
    mockUpsertUserAndGithubAccount.mockResolvedValue(undefined)
  })

  it('returns validation error for invalid GitHub username', async () => {
    const formData = new FormData()
    formData.set('intent', 'link_github')
    formData.set('nav_ident', 'Z990001')
    formData.set('github_username', 'invalid username!')

    const result = await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(result).toEqual({ error: expect.stringContaining('Ugyldig GitHub-brukernavn') })
    expect(mockUpsertUserAndGithubAccount).not.toHaveBeenCalled()
  })

  it('returns validation error for bot account', async () => {
    const formData = new FormData()
    formData.set('intent', 'link_github')
    formData.set('nav_ident', 'Z990001')
    formData.set('github_username', 'snyk-bot')

    const result = await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(result).toEqual({ error: expect.stringContaining('botkonto') })
    expect(mockUpsertUserAndGithubAccount).not.toHaveBeenCalled()
  })

  it('returns error when NAV-ident is not a team member', async () => {
    mockGetDevTeamMembersWithRoles.mockResolvedValue([])

    const formData = new FormData()
    formData.set('intent', 'link_github')
    formData.set('nav_ident', 'Z990002')
    formData.set('github_username', 'glad-fjord')

    const result = await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(result).toEqual({ error: expect.stringContaining('ikke registrert som medlem') })
    expect(mockUpsertUserAndGithubAccount).not.toHaveBeenCalled()
  })

  it('links GitHub account and returns success on happy path', async () => {
    const formData = new FormData()
    formData.set('intent', 'link_github')
    formData.set('nav_ident', 'Z990001')
    formData.set('github_username', 'glad-fjord')

    const result = await action({
      request: makeRequest(formData),
      params: { sectionSlug: 'pensjon', devTeamSlug: 'starte-pensjon' },
    } as never)

    expect(mockUpsertUserAndGithubAccount).toHaveBeenCalledWith(
      expect.objectContaining({ githubUsername: 'glad-fjord', navIdent: 'Z990001' }),
    )
    expect(result).toEqual({ success: expect.stringContaining('glad-fjord') })
  })
})
