import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockGetMonitoredApplicationByIdentity,
  mockCanAccessAppAdmin,
  mockGetSyncJobById,
  mockPoolQuery,
  mockReverifyDeployment,
  mockRunVerification,
  mockGetApprovedDeploymentsMissingApprover,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockGetMonitoredApplicationByIdentity: vi.fn(),
  mockCanAccessAppAdmin: vi.fn(),
  mockGetSyncJobById: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockReverifyDeployment: vi.fn(),
  mockRunVerification: vi.fn(),
  mockGetApprovedDeploymentsMissingApprover: vi.fn(),
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
  getSyncJobById: mockGetSyncJobById,
  getLatestSyncJob: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/verification-diff.server', () => ({
  getApprovedDeploymentsMissingApprover: mockGetApprovedDeploymentsMissingApprover,
}))

vi.mock('~/lib/verification', () => ({
  reverifyDeployment: mockReverifyDeployment,
  runVerification: mockRunVerification,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
}))

import { action, loader } from './$team.env.$env.app.$app.admin.verification-diff'

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin/verification-diff', {
    method: 'POST',
    body: formData,
  })
}

function makeGetRequest(): Request {
  return new Request('http://localhost/team/pensjondeployer/env/prod-fss/app/pensjon-pen/admin/verification-diff')
}

const params = { team: 'pensjondeployer', env: 'prod-fss', app: 'pensjon-pen' }

describe('verification-diff loader - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetMonitoredApplicationByIdentity.mockResolvedValue({ id: 1, team_slug: 'pensjondeployer' })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockPoolQuery.mockResolvedValue({ rows: [] })
    mockGetApprovedDeploymentsMissingApprover.mockResolvedValue([])
  })

  it('checks canAccessAppAdmin before querying deployment diffs or missing approvers', async () => {
    mockCanAccessAppAdmin.mockResolvedValue(false)

    await expect(loader({ request: makeGetRequest(), params } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockPoolQuery).not.toHaveBeenCalled()
    expect(mockGetApprovedDeploymentsMissingApprover).not.toHaveBeenCalled()
  })

  it('returns diffs when the actor has admin access to the app', async () => {
    const result = await loader({ request: makeGetRequest(), params } as never)

    expect(mockCanAccessAppAdmin).toHaveBeenCalledWith({ navIdent: 'Z990010', name: 'Rask Elv' }, 1)
    expect(result.diffs).toEqual([])
  })
})

describe('verification-diff action - IDOR protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetMonitoredApplicationByIdentity.mockResolvedValue({ id: 1 })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockPoolQuery.mockResolvedValue({ rows: [] })
    mockReverifyDeployment.mockResolvedValue({ changed: true, oldStatus: 'a', newStatus: 'b' })
  })

  describe('apply_reverification', () => {
    it('rejects a deployment_id belonging to a different application', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 42, monitored_app_id: 999 }] })

      const formData = new FormData()
      formData.set('action', 'apply_reverification')
      formData.set('deployment_id', '42')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: expect.stringContaining('tilhører ikke denne applikasjonen') })
      expect(mockReverifyDeployment).not.toHaveBeenCalled()
    })

    it('reverifies a deployment that belongs to the authorized application', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 42, monitored_app_id: 1 }] })

      const formData = new FormData()
      formData.set('action', 'apply_reverification')
      formData.set('deployment_id', '42')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(mockReverifyDeployment).toHaveBeenCalledWith(42)
      expect(result).toEqual(expect.objectContaining({ applied: 42 }))
    })

    it('returns an explicit error for a missing or non-numeric deployment_id instead of silently returning null', async () => {
      const formData = new FormData()
      formData.set('action', 'apply_reverification')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: 'Mangler eller ugyldig deployment_id' })
      expect(mockPoolQuery).not.toHaveBeenCalled()
      expect(mockReverifyDeployment).not.toHaveBeenCalled()
    })
  })

  describe('apply_all', () => {
    it('skips deployment_ids belonging to other applications and only reverifies owned ones', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, monitored_app_id: 1 },
          { id: 2, monitored_app_id: 999 },
        ],
      })

      const formData = new FormData()
      formData.set('action', 'apply_all')
      formData.append('deployment_ids', '1')
      formData.append('deployment_ids', '2')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(mockReverifyDeployment).toHaveBeenCalledTimes(1)
      expect(mockReverifyDeployment).toHaveBeenCalledWith(1)
      expect(result).toEqual(expect.objectContaining({ applied: 1, errors: 1 }))
    })

    it('filters out non-finite deployment_ids before querying ownership', async () => {
      const formData = new FormData()
      formData.set('action', 'apply_all')
      formData.append('deployment_ids', 'not-a-number')
      formData.append('deployment_ids', '1')

      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1, monitored_app_id: 1 }] })

      await action({ request: makeRequest(formData), params } as never)

      expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [[1]])
    })
  })

  describe('check_compute_status', () => {
    it('rejects a job_id belonging to a different application', async () => {
      mockGetSyncJobById.mockResolvedValue({ id: 7, monitored_app_id: 999 })

      const formData = new FormData()
      formData.set('action', 'check_compute_status')
      formData.set('job_id', '7')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: expect.stringContaining('Fant ikke jobb') })
    })

    it('returns job status for a job belonging to the authorized application', async () => {
      mockGetSyncJobById.mockResolvedValue({ id: 7, monitored_app_id: 1 })

      const formData = new FormData()
      formData.set('action', 'check_compute_status')
      formData.set('job_id', '7')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ computeJobStatus: { id: 7, monitored_app_id: 1 } })
    })

    it('returns an explicit error for a missing or non-numeric job_id', async () => {
      const formData = new FormData()
      formData.set('action', 'check_compute_status')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: 'Mangler eller ugyldig job_id' })
      expect(mockGetSyncJobById).not.toHaveBeenCalled()
    })
  })

  it('rejects all mutating actions when the actor lacks admin access to the app', async () => {
    mockCanAccessAppAdmin.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'apply_reverification')
    formData.set('deployment_id', '42')

    const result = await action({ request: makeRequest(formData), params } as never)

    expect(result).toEqual({ error: 'Du har ikke tilgang til å administrere denne applikasjonen' })
    expect(mockPoolQuery).not.toHaveBeenCalled()
    expect(mockReverifyDeployment).not.toHaveBeenCalled()
  })
})
