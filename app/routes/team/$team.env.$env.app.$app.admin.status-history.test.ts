import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockGetMonitoredApplicationByIdentity,
  mockCanAccessAppAdmin,
  mockGetDeploymentsWithStatusChanges,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockGetMonitoredApplicationByIdentity: vi.fn(),
  mockCanAccessAppAdmin: vi.fn(),
  mockGetDeploymentsWithStatusChanges: vi.fn(),
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
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetMonitoredApplicationByIdentity.mockResolvedValue({ id: 1, team_slug: 'pensjondeployer' })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockGetDeploymentsWithStatusChanges.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before fetching any status history', async () => {
    mockCanAccessAppAdmin.mockResolvedValue(false)
    const request = makeRequest()

    await expect(loader({ params: makeParams(), request } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetDeploymentsWithStatusChanges).not.toHaveBeenCalled()
  })

  it('returns status history when the actor has admin access to the app', async () => {
    const request = makeRequest()

    const result = await loader({ params: makeParams(), request } as never)

    expect(mockCanAccessAppAdmin).toHaveBeenCalledWith({ navIdent: 'Z990010', name: 'Rask Elv' }, 1)
    expect(result.deployments).toEqual([])
  })
})
