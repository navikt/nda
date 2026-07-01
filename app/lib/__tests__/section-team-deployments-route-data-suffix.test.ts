import { describe, expect, it, vi } from 'vitest'

vi.mock('~/db/dev-teams.server', () => ({
  getDevTeamBySlug: vi.fn().mockResolvedValue({ id: 1, nais_team_slugs: ['plattform'] }),
  getDevTeamApplications: vi.fn().mockResolvedValue([{ monitored_app_id: 1 }]),
  getGroupAppIdsForDevTeams: vi.fn().mockResolvedValue([]),
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getAllMonitoredApplications: vi.fn().mockResolvedValue([{ id: 1, is_active: true, team_slug: 'plattform' }]),
}))

vi.mock('~/db/role-assignments.server', () => ({
  getMembersGithubUsernamesForDevTeamRoles: vi.fn().mockResolvedValue([]),
}))

vi.mock('~/lib/auth.server', () => ({
  getUserIdentity: vi.fn().mockResolvedValue(null),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}))

import { loader } from '../../routes/sections.$sectionSlug.teams.$devTeamSlug.deployments'

describe('section team deployments loader goal-filter redirect (React Router v8 .data suffix)', () => {
  it('redirects to a cleaned url without leaking the .data suffix from request.url', async () => {
    let redirectResponse: Response | undefined
    try {
      await loader({
        params: { sectionSlug: 'plattform', devTeamSlug: 'nda-team' },
        request: new Request(
          'http://localhost/sections/plattform/teams/nda-team/deployments.data?goal=obj:not-a-number',
        ),
        url: new URL('http://localhost/sections/plattform/teams/nda-team/deployments?goal=obj:not-a-number'),
      } as never)
    } catch (thrown) {
      redirectResponse = thrown as Response
    }

    expect(redirectResponse).toBeInstanceOf(Response)
    const location = redirectResponse?.headers.get('Location')
    expect(location).toBe('/sections/plattform/teams/nda-team/deployments?page=1')
    expect(location).not.toContain('.data')
  })
})
