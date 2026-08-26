import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireUser, mockGetMonitoredApplicationByIdentity, mockCanAccessAppAdmin, mockGetSyncJobsForApp } =
  vi.hoisted(() => ({
    mockRequireUser: vi.fn(),
    mockGetMonitoredApplicationByIdentity: vi.fn(),
    mockCanAccessAppAdmin: vi.fn(),
    mockGetSyncJobsForApp: vi.fn(),
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

vi.mock('~/db/sync-jobs.server', () => ({
  getSyncJobsForApp: mockGetSyncJobsForApp,
}))

vi.mock('~/db/sync-job-types', () => ({
  SYNC_JOB_STATUS_LABELS: {},
  SYNC_JOB_TYPE_LABELS: {},
}))

import { loader } from './$team.env.$env.app.$app.admin.sync-jobs'

function makeRequest(): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin/sync-jobs')
}

function makeParams() {
  return { team: 'pensjondeployer', env: 'prod-fss', app: 'pensjon-pen' }
}

describe('sync-jobs loader - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetMonitoredApplicationByIdentity.mockResolvedValue({ id: 1, team_slug: 'pensjondeployer' })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockGetSyncJobsForApp.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before fetching any sync jobs', async () => {
    mockCanAccessAppAdmin.mockResolvedValue(false)
    const request = makeRequest()

    await expect(loader({ params: makeParams(), request } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetSyncJobsForApp).not.toHaveBeenCalled()
  })

  it('returns sync jobs when the actor has admin access to the app', async () => {
    const request = makeRequest()

    const result = await loader({ params: makeParams(), request } as never)

    expect(mockCanAccessAppAdmin).toHaveBeenCalledWith({ navIdent: 'Z990010', name: 'Rask Elv' }, 1)
    expect(result.jobs).toEqual([])
  })
})
