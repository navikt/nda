import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireUser, mockGetMonitoredApplicationByIdentity, mockCanAccessAppAdmin, mockGetDeviationsByAppId } =
  vi.hoisted(() => ({
    mockRequireUser: vi.fn(),
    mockGetMonitoredApplicationByIdentity: vi.fn(),
    mockCanAccessAppAdmin: vi.fn(),
    mockGetDeviationsByAppId: vi.fn(),
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
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetMonitoredApplicationByIdentity.mockResolvedValue({ id: 1, team_slug: 'pensjondeployer' })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockGetDeviationsByAppId.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before fetching any deviations', async () => {
    mockCanAccessAppAdmin.mockResolvedValue(false)
    const request = makeRequest()

    await expect(loader({ params: makeParams(), request, url: new URL(request.url) } as never)).rejects.toMatchObject({
      status: 403,
    })

    expect(mockGetDeviationsByAppId).not.toHaveBeenCalled()
  })

  it('returns deviations when the actor has admin access to the app', async () => {
    const request = makeRequest()

    const result = await loader({ params: makeParams(), request, url: new URL(request.url) } as never)

    expect(mockCanAccessAppAdmin).toHaveBeenCalledWith({ navIdent: 'Z990010', name: 'Rask Elv' }, 1)
    expect(result.deviations).toEqual([])
  })
})
