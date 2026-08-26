import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAppAdminAccess, mockGetSyncJobsForApp } = vi.hoisted(() => ({
  mockRequireAppAdminAccess: vi.fn(),
  mockGetSyncJobsForApp: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  requireAppAdminAccess: mockRequireAppAdminAccess,
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
    mockRequireAppAdminAccess.mockResolvedValue({
      user: { navIdent: 'Z990010', name: 'Rask Elv' },
      app: { id: 1, team_slug: 'pensjondeployer' },
    })
    mockGetSyncJobsForApp.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before fetching any sync jobs', async () => {
    mockRequireAppAdminAccess.mockRejectedValue(new Response('Forbidden - admin access required', { status: 403 }))
    const request = makeRequest()

    await expect(loader({ params: makeParams(), request } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetSyncJobsForApp).not.toHaveBeenCalled()
  })

  it('returns sync jobs when the actor has admin access to the app', async () => {
    const request = makeRequest()

    const result = await loader({ params: makeParams(), request } as never)

    expect(mockRequireAppAdminAccess).toHaveBeenCalledWith(request, makeParams())
    expect(result.jobs).toEqual([])
  })
})
