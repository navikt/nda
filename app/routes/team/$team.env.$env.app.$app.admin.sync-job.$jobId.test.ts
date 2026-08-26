import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAppAdminAccess, mockGetSyncJobById, mockGetSyncJobLogs } = vi.hoisted(() => ({
  mockRequireAppAdminAccess: vi.fn(),
  mockGetSyncJobById: vi.fn(),
  mockGetSyncJobLogs: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  requireAppAdminAccess: mockRequireAppAdminAccess,
}))

vi.mock('~/db/sync-jobs.server', () => ({
  getSyncJobById: mockGetSyncJobById,
  getSyncJobLogs: mockGetSyncJobLogs,
  SYNC_JOB_STATUS_LABELS: {},
  SYNC_JOB_TYPE_LABELS: {},
}))

import { loader } from './$team.env.$env.app.$app.admin.sync-job.$jobId'

function makeRequest(): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin/sync-job/5')
}

function makeParams(jobId: string) {
  return { team: 'pensjondeployer', env: 'prod-fss', app: 'pensjon-pen', jobId }
}

describe('sync-job detail loader - IDOR protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAppAdminAccess.mockResolvedValue({
      user: { navIdent: 'Z990010', name: 'Rask Elv' },
      app: { id: 1 },
    })
    mockGetSyncJobById.mockResolvedValue({ id: 5, monitored_app_id: 1, job_type: 'fetch_data', status: 'completed' })
    mockGetSyncJobLogs.mockResolvedValue([])
  })

  it('returns 400 for a non-numeric job ID without touching authorization or the database', async () => {
    await expect(
      loader({ params: makeParams('not-a-number'), request: makeRequest(), url: new URL(makeRequest().url) } as never),
    ).rejects.toMatchObject({ status: 400 })

    expect(mockRequireAppAdminAccess).not.toHaveBeenCalled()
    expect(mockGetSyncJobById).not.toHaveBeenCalled()
  })

  it('checks authorization before fetching the job (no info leak via 404 vs 403)', async () => {
    mockRequireAppAdminAccess.mockRejectedValue(new Response('Forbidden - admin access required', { status: 403 }))

    await expect(
      loader({ params: makeParams('5'), request: makeRequest(), url: new URL(makeRequest().url) } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetSyncJobById).not.toHaveBeenCalled()
  })

  it('returns 404 when the job belongs to a different application than the URL app', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 5, monitored_app_id: 999, job_type: 'fetch_data', status: 'completed' })

    await expect(
      loader({ params: makeParams('5'), request: makeRequest(), url: new URL(makeRequest().url) } as never),
    ).rejects.toMatchObject({ status: 404 })

    expect(mockGetSyncJobLogs).not.toHaveBeenCalled()
  })

  it('returns job details when authorized and job belongs to the app', async () => {
    const result = await loader({
      params: makeParams('5'),
      request: makeRequest(),
      url: new URL(makeRequest().url),
    } as never)

    expect(result.job).toEqual(expect.objectContaining({ id: 5, monitored_app_id: 1 }))
  })
})
