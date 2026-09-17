import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

const {
  mockGetDeploymentsPaginated,
  mockGetDevTeamBySlug,
  mockGetDevTeamsForApps,
  mockGetDevTeamsForGithubUsernamesByRole,
  mockGetMembersGithubUsernamesForDevTeamRoles,
  mockGetUserDevTeamsByRole,
  mockGetGithubUserLookups,
  mockGetUserByIdentifier,
  mockGetLinkedObjectivesForApps,
} = vi.hoisted(() => ({
  mockGetDeploymentsPaginated: vi.fn(),
  mockGetDevTeamBySlug: vi.fn(),
  mockGetDevTeamsForApps: vi.fn(),
  mockGetDevTeamsForGithubUsernamesByRole: vi.fn(),
  mockGetMembersGithubUsernamesForDevTeamRoles: vi.fn(),
  mockGetUserDevTeamsByRole: vi.fn(),
  mockGetGithubUserLookups: vi.fn(),
  mockGetUserByIdentifier: vi.fn(),
  mockGetLinkedObjectivesForApps: vi.fn(),
}))

vi.mock('~/db/deployments.server', () => ({
  getDeploymentsPaginated: mockGetDeploymentsPaginated,
}))

vi.mock('~/db/dev-teams.server', () => ({
  getDevTeamBySlug: mockGetDevTeamBySlug,
  getDevTeamsForApps: mockGetDevTeamsForApps,
}))

vi.mock('~/db/role-assignments.server', () => ({
  getDevTeamsForGithubUsernamesByRole: mockGetDevTeamsForGithubUsernamesByRole,
  getMembersGithubUsernamesForDevTeamRoles: mockGetMembersGithubUsernamesForDevTeamRoles,
  getUserDevTeamsByRole: mockGetUserDevTeamsByRole,
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getGithubUserLookups: mockGetGithubUserLookups,
  getUserByIdentifier: mockGetUserByIdentifier,
}))

vi.mock('~/db/deployment-goal-links.server', () => ({
  getLinkedObjectivesForApps: mockGetLinkedObjectivesForApps,
}))

import { pool } from '~/db/connection.server'
import { getMultiAppDeploymentsPageData } from '~/lib/deployments/multi-app-deployments.server'

const mockPoolQuery = pool.query as Mock

const currentUser = {
  navIdent: 'Z990001',
  name: 'Glad Fjord',
  role: 'user' as const,
  isActualAdmin: false,
  adminSuppressed: false,
  entraGroups: [] as string[],
}

const apps = [
  { id: 1, team_slug: 'nais-team-a' },
  { id: 2, team_slug: 'nais-team-b' },
]

function mockPoolQueryDefaults() {
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes('FROM verification_runs')) return Promise.resolve({ rows: [] })
    if (sql.includes('SELECT DISTINCT d.deployer_username')) return Promise.resolve({ rows: [] })
    if (sql.includes('UNION')) return Promise.resolve({ rows: [] })
    if (sql.includes('workflow_trigger_config')) return Promise.resolve({ rows: [] })
    return Promise.resolve({ rows: [] })
  })
}

describe('getMultiAppDeploymentsPageData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPoolQueryDefaults()
    mockGetDevTeamsForApps.mockResolvedValue([])
    mockGetDevTeamBySlug.mockResolvedValue(null)
    mockGetDevTeamsForGithubUsernamesByRole.mockResolvedValue([])
    mockGetLinkedObjectivesForApps.mockResolvedValue([])
    mockGetGithubUserLookups.mockResolvedValue(new Map())
    mockGetUserByIdentifier.mockResolvedValue(null)
    mockGetDeploymentsPaginated.mockResolvedValue({ deployments: [], total: 0, page: 1, per_page: 20, total_pages: 0 })
  })

  it('always requests the per-app audit-year boundary instead of a fixed year', async () => {
    await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: '' }, null)

    const calledFilters = mockGetDeploymentsPaginated.mock.calls[0][0]
    expect(calledFilters).toMatchObject({ monitored_app_ids: [1, 2], per_app_audit_start_year: true })
    expect(calledFilters).not.toHaveProperty('audit_start_year')
  })

  it('marks the team filter empty with no-user-teams when the current user has no dev teams', async () => {
    mockGetUserDevTeamsByRole.mockResolvedValue([])

    const result = await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: 'mine' }, currentUser)

    expect(result.teamFilterEmptyReason).toBe('no-user-teams')
    expect(mockGetMembersGithubUsernamesForDevTeamRoles).not.toHaveBeenCalled()
    expect(mockGetDeploymentsPaginated).toHaveBeenCalledWith(expect.objectContaining({ deployer_usernames: [] }))
  })

  it('marks the team filter empty with no-team-members when the user teams have no members', async () => {
    mockGetUserDevTeamsByRole.mockResolvedValue([{ id: 10, slug: 'nais-team-a' }])
    mockGetMembersGithubUsernamesForDevTeamRoles.mockResolvedValue([])

    const result = await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: 'mine' }, currentUser)

    expect(result.teamFilterEmptyReason).toBe('no-team-members')
    expect(mockGetMembersGithubUsernamesForDevTeamRoles).toHaveBeenCalledWith([10])
  })

  it('filters by a specific team slug resolved via getDevTeamBySlug when it does not own any of the apps', async () => {
    mockGetDevTeamsForApps.mockResolvedValue([{ id: 1, slug: 'nais-team-a', name: 'Team A' }])
    mockGetDevTeamBySlug.mockResolvedValue({ id: 20, slug: 'nais-team-other', name: 'Team Other' })
    mockGetMembersGithubUsernamesForDevTeamRoles.mockResolvedValue(['some-github-user'])

    await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: 'nais-team-other' }, null)

    expect(mockGetDevTeamBySlug).toHaveBeenCalledWith('nais-team-other')
    expect(mockGetMembersGithubUsernamesForDevTeamRoles).toHaveBeenCalledWith([20])
    expect(mockGetDeploymentsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ deployer_usernames: ['some-github-user'] }),
    )
  })

  it('marks the team filter empty with no-team-members when a specific team slug has no members', async () => {
    mockGetDevTeamsForApps.mockResolvedValue([{ id: 1, slug: 'nais-team-a', name: 'Team A' }])
    mockGetMembersGithubUsernamesForDevTeamRoles.mockResolvedValue([])

    const result = await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: 'nais-team-a' }, null)

    expect(mockGetDevTeamBySlug).not.toHaveBeenCalled()
    expect(mockGetMembersGithubUsernamesForDevTeamRoles).toHaveBeenCalledWith([1])
    expect(result.teamFilterEmptyReason).toBe('no-team-members')
    expect(mockGetDeploymentsPaginated).toHaveBeenCalledWith(expect.objectContaining({ deployer_usernames: [] }))
  })

  it('builds deployer options and flags unmapped deployers from the metadata queries', async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT DISTINCT d.deployer_username')) {
        return Promise.resolve({ rows: [{ deployer_username: 'known-user' }, { deployer_username: 'unknown-user' }] })
      }
      return Promise.resolve({ rows: [] })
    })
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([['known-user', { display_name: 'Kjent Bruker', nav_ident: 'Z990002', account_deleted_at: null }]]),
    )

    const result = await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: '' }, null)

    expect(result.deployerOptions).toEqual(
      expect.arrayContaining([
        { value: 'known-user', label: 'Kjent Bruker' },
        { value: 'unknown-user', label: 'unknown-user' },
      ]),
    )
    expect(result.hasUnmappedDeployers).toBe(true)
  })

  it('maps error deployments to their verification reasons', async () => {
    mockGetDeploymentsPaginated.mockResolvedValue({
      deployments: [{ id: 42, four_eyes_status: 'error' }],
      total: 1,
      page: 1,
      per_page: 20,
      total_pages: 1,
    })
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM verification_runs')) {
        return Promise.resolve({
          rows: [{ deployment_id: 42, result: { approvalDetails: { reason: 'Missing approval' } } }],
        })
      }
      return Promise.resolve({ rows: [] })
    })

    const result = await getMultiAppDeploymentsPageData(apps, { page: 1, teamFilter: '' }, null)

    expect(result.errorReasons).toEqual({ 42: 'Missing approval' })
  })
})
