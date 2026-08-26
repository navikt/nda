import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAppAdminAccess, mockGetDeploymentsWithStatusChanges } = vi.hoisted(() => ({
  mockRequireAppAdminAccess: vi.fn(),
  mockGetDeploymentsWithStatusChanges: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  requireAppAdminAccess: mockRequireAppAdminAccess,
}))

vi.mock('~/db/deployments.server', () => ({
  getDeploymentsWithStatusChanges: mockGetDeploymentsWithStatusChanges,
}))

import { loader } from './$team.env.$env.app.$app.admin.status-history'

function makeRequest(): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin/status-history')
}

function makeParams() {
  return { team: 'pensjondeployer', env: 'prod-fss', app: 'pensjon-pen' }
}

describe('status-history loader - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAppAdminAccess.mockResolvedValue({
      user: { navIdent: 'Z990010', name: 'Rask Elv' },
      app: { id: 1, team_slug: 'pensjondeployer' },
    })
    mockGetDeploymentsWithStatusChanges.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before fetching any status history', async () => {
    mockRequireAppAdminAccess.mockRejectedValue(new Response('Forbidden - admin access required', { status: 403 }))
    const request = makeRequest()

    await expect(loader({ params: makeParams(), request } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetDeploymentsWithStatusChanges).not.toHaveBeenCalled()
  })

  it('returns status history when the actor has admin access to the app', async () => {
    const request = makeRequest()

    const result = await loader({ params: makeParams(), request } as never)

    expect(mockRequireAppAdminAccess).toHaveBeenCalledWith(request, makeParams())
    expect(result.deployments).toEqual([])
  })
})
