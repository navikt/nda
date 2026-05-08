import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/db/dev-teams.server', () => ({
  getDevTeamApplications: vi.fn(),
  getGroupAppIdsForDevTeams: vi.fn(),
}))

vi.mock('~/db/role-assignments.server', () => ({
  getMembersGithubUsernamesForDevTeamRoles: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { resolveDevTeamScope } from '~/db/deployments/home.server'
import { getDevTeamApplications, getGroupAppIdsForDevTeams } from '~/db/dev-teams.server'
import { getMembersGithubUsernamesForDevTeamRoles } from '~/db/role-assignments.server'

const mockGetDevTeamApplications = vi.mocked(getDevTeamApplications)
const mockGetGroupAppIds = vi.mocked(getGroupAppIdsForDevTeams)
const mockGetMembersUsernames = vi.mocked(getMembersGithubUsernamesForDevTeamRoles)

describe('resolveDevTeamScope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetDevTeamApplications.mockResolvedValue([])
    mockGetGroupAppIds.mockResolvedValue([])
    mockGetMembersUsernames.mockResolvedValue(['user-a', 'user-b'])
  })

  it('deduplicates nais team slugs across dev teams', async () => {
    const devTeams = [
      { id: 1, nais_team_slugs: ['team-a', 'team-b'] },
      { id: 2, nais_team_slugs: ['team-b', 'team-c'] },
    ]

    const scope = await resolveDevTeamScope(devTeams)

    expect(scope.naisTeamSlugs).toEqual(['team-a', 'team-b', 'team-c'])
  })

  it('merges direct app IDs and group app IDs (deduped)', async () => {
    const devTeams = [{ id: 1, nais_team_slugs: ['t'] }]

    mockGetDevTeamApplications.mockResolvedValue([{ monitored_app_id: 10 }, { monitored_app_id: 20 }] as Awaited<
      ReturnType<typeof getDevTeamApplications>
    >)
    mockGetGroupAppIds.mockResolvedValue([20, 30])

    const scope = await resolveDevTeamScope(devTeams)

    expect(scope.directAppIds).toEqual(expect.arrayContaining([10, 20, 30]))
    expect(scope.directAppIds).toHaveLength(3)
  })

  it('returns undefined directAppIds when no apps found', async () => {
    const devTeams = [{ id: 1, nais_team_slugs: ['t'] }]

    const scope = await resolveDevTeamScope(devTeams)

    expect(scope.directAppIds).toBeUndefined()
  })

  it('returns deployer usernames from member mappings', async () => {
    const devTeams = [{ id: 1, nais_team_slugs: ['t'] }]
    mockGetMembersUsernames.mockResolvedValue(['alice', 'bob'])

    const scope = await resolveDevTeamScope(devTeams)

    expect(scope.deployerUsernames).toEqual(['alice', 'bob'])
    expect(scope.noMembersMapped).toBe(false)
  })

  it('sets noMembersMapped when deployer list is empty', async () => {
    const devTeams = [{ id: 1, nais_team_slugs: ['t'] }]
    mockGetMembersUsernames.mockResolvedValue([])

    const scope = await resolveDevTeamScope(devTeams)

    expect(scope.deployerUsernames).toEqual([])
    expect(scope.noMembersMapped).toBe(true)
  })

  it('falls back to undefined deployer usernames on error', async () => {
    const devTeams = [{ id: 1, nais_team_slugs: ['t'] }]
    mockGetMembersUsernames.mockRejectedValue(new Error('DB error'))

    const scope = await resolveDevTeamScope(devTeams)

    expect(scope.deployerUsernames).toBeUndefined()
    expect(scope.noMembersMapped).toBe(false)
  })

  it('queries all dev team IDs for group apps and members', async () => {
    const devTeams = [
      { id: 5, nais_team_slugs: ['t1'] },
      { id: 9, nais_team_slugs: ['t2'] },
    ]

    await resolveDevTeamScope(devTeams)

    expect(mockGetDevTeamApplications).toHaveBeenCalledTimes(2)
    expect(mockGetDevTeamApplications).toHaveBeenCalledWith(5)
    expect(mockGetDevTeamApplications).toHaveBeenCalledWith(9)
    expect(mockGetGroupAppIds).toHaveBeenCalledWith([5, 9])
    expect(mockGetMembersUsernames).toHaveBeenCalledWith([5, 9])
  })
})
