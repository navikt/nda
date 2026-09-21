import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireUser, mockCanAccessAppAdmin, mockGetSyncJobById } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCanAccessAppAdmin: vi.fn(),
  mockGetSyncJobById: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/authorization.server', () => ({
  canAccessAppAdmin: mockCanAccessAppAdmin,
}))

vi.mock('~/db/app-settings.server', () => ({
  recordAppConfigAuditLog: vi.fn(),
}))

vi.mock('~/db/audit-reports.server', () => ({
  archiveAuditReport: vi.fn(),
  checkAuditReadiness: vi.fn(),
  hasActiveReportForPeriod: vi.fn(),
  restoreAuditReport: vi.fn(),
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationById: vi.fn(),
  getMonitoredApplicationByIdentity: vi.fn(),
  updateMonitoredApplication: vi.fn(),
}))

vi.mock('~/db/report-jobs.server', () => ({
  createReportJob: vi.fn(),
  isStaleJob: vi.fn(),
}))

vi.mock('~/db/sync-jobs.server', () => ({
  acquireSyncLock: vi.fn(),
  getLatestSyncJob: vi.fn(),
  getSyncJobById: mockGetSyncJobById,
  heartbeatSyncJob: vi.fn(),
  releaseSyncLock: vi.fn(),
  SYNC_INTERVAL_MS: 60000,
  updateSyncJobProgress: vi.fn(),
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getGithubUserLookups: vi.fn(),
}))

vi.mock('~/lib/date-utils', () => ({
  endOfDay: vi.fn(),
  parseLocalDate: vi.fn(),
}))

vi.mock('~/lib/form-validators', () => ({
  getFormString: (formData: FormData, key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  },
  isValidSlackChannel: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
  runWithJobContext: vi.fn(
    async (_jobId: number, _jobType: string, _appId: number, _debug: boolean, fn: () => Promise<void>) => {
      await fn()
    },
  ),
}))

vi.mock('~/lib/report-job-processor.server', () => ({
  processReportJobAsync: vi.fn(),
}))

vi.mock('~/lib/report-periods', () => ({
  isValidReportPeriodType: vi.fn(),
}))

vi.mock('~/lib/user-display', () => ({
  serializeUserLookups: vi.fn(),
}))

vi.mock('~/lib/verification/compute-diffs.server', () => ({
  computeVerificationDiffs: vi.fn(),
}))

vi.mock('~/lib/verification/types', () => ({
  isImplicitApprovalMode: vi.fn(),
}))

import { action } from './$team.env.$env.app.$app.admin.actions.server'

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin', {
    method: 'POST',
    body: formData,
  })
}

describe('admin actions - JOB_ID_ACTIONS IDOR protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockGetSyncJobById.mockResolvedValue({ id: 5, monitored_app_id: 1, status: 'completed' })
  })

  it("authorizes using the job's real owning app, ignoring a spoofed app_id form field", async () => {
    const formData = new FormData()
    formData.set('action', 'check_compute_diffs_status')
    formData.set('job_id', '5')
    formData.set('app_id', '999')

    await action({ request: makeRequest(formData), params: {} } as never)

    expect(mockCanAccessAppAdmin).toHaveBeenCalledWith(expect.anything(), 1)
    expect(mockCanAccessAppAdmin).not.toHaveBeenCalledWith(expect.anything(), 999)
  })

  it("rejects when the actor lacks admin access to the job's owning app", async () => {
    mockCanAccessAppAdmin.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'check_compute_diffs_status')
    formData.set('job_id', '5')

    const result = await action({ request: makeRequest(formData), params: {} } as never)

    expect(result).toEqual({ error: 'Du har ikke tilgang til denne jobben' })
  })

  it('rejects when the job does not exist', async () => {
    mockGetSyncJobById.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('action', 'check_compute_diffs_status')
    formData.set('job_id', '404')

    const result = await action({ request: makeRequest(formData), params: {} } as never)

    expect(result).toEqual({ error: 'Du har ikke tilgang til denne jobben' })
    expect(mockCanAccessAppAdmin).not.toHaveBeenCalled()
  })

  it('rejects when job_id is missing or non-numeric', async () => {
    const formData = new FormData()
    formData.set('action', 'check_compute_diffs_status')

    const result = await action({ request: makeRequest(formData), params: {} } as never)

    expect(result).toEqual({ error: 'Mangler eller ugyldig job_id' })
    expect(mockGetSyncJobById).not.toHaveBeenCalled()
  })

  it('reuses the job fetched during authorization for check_compute_diffs_status instead of refetching it', async () => {
    const formData = new FormData()
    formData.set('action', 'check_compute_diffs_status')
    formData.set('job_id', '5')

    const result = await action({ request: makeRequest(formData), params: {} } as never)

    expect(mockGetSyncJobById).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ computeDiffsJobStatus: { id: 5, monitored_app_id: 1, status: 'completed' } })
  })
})
