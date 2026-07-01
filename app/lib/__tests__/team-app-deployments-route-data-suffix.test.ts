import { describe, expect, it, vi } from 'vitest'

vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationByIdentity: vi.fn().mockResolvedValue({
    id: 7,
    team_slug: 'plattform',
    environment_name: 'prod',
    app_name: 'nda',
    audit_start_year: 2023,
  }),
}))

vi.mock('~/db/application-groups.server', () => ({
  getGroupContext: vi.fn().mockResolvedValue({ group: null, siblings: [] }),
}))

vi.mock('~/lib/auth.server', () => ({
  getUserIdentity: vi.fn().mockResolvedValue(null),
}))

vi.mock('~/db/dev-teams.server', () => ({
  getDevTeamsForApp: vi.fn().mockResolvedValue([]),
  getDevTeamsForApps: vi.fn().mockResolvedValue([]),
  getDevTeamBySlug: vi.fn().mockResolvedValue(null),
}))

vi.mock('~/db/role-assignments.server', () => ({
  getDevTeamsForGithubUsernamesByRole: vi.fn().mockResolvedValue([]),
  getMembersGithubUsernamesForDevTeamRoles: vi.fn().mockResolvedValue([]),
  getUserDevTeamsByRole: vi.fn().mockResolvedValue([]),
}))

vi.mock('~/db/deployments.server', () => ({
  getDeploymentsPaginated: vi.fn().mockResolvedValue({ deployments: [], total: 0, total_pages: 1 }),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}))

import { loader } from '../../routes/team/$team.env.$env.app.$app.deployments'

describe('team deployments loader pagination redirect (React Router v8 .data suffix)', () => {
  it('redirects to a clamped page without leaking the .data suffix from request.url', async () => {
    let redirectResponse: Response | undefined
    try {
      await loader({
        params: { team: 'plattform', env: 'prod', app: 'nda' },
        request: new Request('http://localhost/team/plattform/env/prod/app/nda/deployments.data?page=999'),
        url: new URL('http://localhost/team/plattform/env/prod/app/nda/deployments?page=999'),
      } as never)
    } catch (thrown) {
      redirectResponse = thrown as Response
    }

    expect(redirectResponse).toBeInstanceOf(Response)
    const location = redirectResponse?.headers.get('Location')
    expect(location).toBe('/team/plattform/env/prod/app/nda/deployments?page=1')
    expect(location).not.toContain('.data')
  })
})
