import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAppAdminAccess, mockGetDeviationsByAppId } = vi.hoisted(() => ({
  mockRequireAppAdminAccess: vi.fn(),
  mockGetDeviationsByAppId: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  requireAppAdminAccess: mockRequireAppAdminAccess,
}))

vi.mock('~/db/deviations.server', () => ({
  getDeviationsByAppId: mockGetDeviationsByAppId,
}))

import { loader } from './$team.env.$env.app.$app.admin.deviations'

function makeRequest(): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin/deviations')
}

function makeParams() {
  return { team: 'pensjondeployer', env: 'prod-fss', app: 'pensjon-pen' }
}

describe('deviations loader - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAppAdminAccess.mockResolvedValue({
      user: { navIdent: 'Z990010', name: 'Rask Elv' },
      app: { id: 1, team_slug: 'pensjondeployer' },
    })
    mockGetDeviationsByAppId.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before fetching any deviations', async () => {
    mockRequireAppAdminAccess.mockRejectedValue(new Response('Forbidden - admin access required', { status: 403 }))
    const request = makeRequest()

    await expect(loader({ params: makeParams(), request, url: new URL(request.url) } as never)).rejects.toMatchObject({
      status: 403,
    })

    expect(mockGetDeviationsByAppId).not.toHaveBeenCalled()
  })

  it('returns deviations when the actor has admin access to the app', async () => {
    const request = makeRequest()

    const result = await loader({ params: makeParams(), request, url: new URL(request.url) } as never)

    expect(mockRequireAppAdminAccess).toHaveBeenCalledWith(request, makeParams())
    expect(result.deviations).toEqual([])
  })
})
