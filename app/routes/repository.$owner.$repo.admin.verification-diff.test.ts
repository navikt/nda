import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryAdminAccess,
  mockGetRepositoryById,
  mockIsCurrentOrHistoricalNameForRepositoryId,
  mockGetLatestSyncJobForRepository,
  mockGetSyncJobById,
  mockGetGithubUserLookups,
  mockPoolQuery,
  mockReverifyDeployment,
  mockGetVerificationDiffsForRepository,
  mockGetApprovedDeploymentsMissingApproverForApps,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetRepositoryById: vi.fn(),
  mockIsCurrentOrHistoricalNameForRepositoryId: vi.fn(),
  mockGetLatestSyncJobForRepository: vi.fn(),
  mockGetSyncJobById: vi.fn(),
  mockGetGithubUserLookups: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockReverifyDeployment: vi.fn(),
  mockGetVerificationDiffsForRepository: vi.fn(),
  mockGetApprovedDeploymentsMissingApproverForApps: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/repository-resolution.server', () => ({
  resolveRepositoryFromParams: mockResolveRepositoryFromParams,
}))

vi.mock('~/lib/authorization.server', () => ({
  resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess,
}))

vi.mock('~/db/repositories.server', () => ({
  getRepositoryById: mockGetRepositoryById,
  isCurrentOrHistoricalNameForRepositoryId: mockIsCurrentOrHistoricalNameForRepositoryId,
}))

vi.mock('~/db/sync-jobs.server', () => ({
  getLatestSyncJobForRepository: mockGetLatestSyncJobForRepository,
  getSyncJobById: mockGetSyncJobById,
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getGithubUserLookups: mockGetGithubUserLookups,
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/lib/verification', () => ({
  reverifyDeployment: mockReverifyDeployment,
}))

vi.mock('~/db/verification-diff.server', () => ({
  getVerificationDiffsForRepository: mockGetVerificationDiffsForRepository,
  getApprovedDeploymentsMissingApproverForApps: mockGetApprovedDeploymentsMissingApproverForApps,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
}))

import {
  action,
  deriveComputeJobState,
  deriveRefreshJobState,
  loader,
} from './repository.$owner.$repo.admin.verification-diff'

const params = { owner: 'navikt', repo: 'mulighetsrommet' }

function makeGetRequest(): Request {
  return new Request('http://localhost/repository/navikt/mulighetsrommet/admin/verification-diff')
}

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/repository/navikt/mulighetsrommet/admin/verification-diff', {
    method: 'POST',
    body: formData,
  })
}

const repository = { id: 5, github_owner: 'navikt', github_repo_name: 'mulighetsrommet' }

describe('verification-diff loader - authorization scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockGetLatestSyncJobForRepository.mockResolvedValue(null)
    mockGetVerificationDiffsForRepository.mockResolvedValue([])
    mockGetApprovedDeploymentsMissingApproverForApps.mockResolvedValue([])
    mockGetGithubUserLookups.mockResolvedValue(new Map())
  })

  it('throws 403 when the actor is not authorized for the repository', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    await expect(loader({ request: makeGetRequest(), params } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetVerificationDiffsForRepository).not.toHaveBeenCalled()
    expect(mockGetApprovedDeploymentsMissingApproverForApps).not.toHaveBeenCalled()
  })

  it('scopes diffs to the repository ID and the authoritative affectedApps app IDs, matching missing-approver scoping', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({
      authorized: true,
      affectedApps: [{ id: 1 }, { id: 2 }],
    })

    await loader({ request: makeGetRequest(), params } as never)

    expect(mockGetVerificationDiffsForRepository).toHaveBeenCalledWith(repository.id, [1, 2])
    expect(mockGetApprovedDeploymentsMissingApproverForApps).toHaveBeenCalledWith([1, 2])
  })
})

describe('verification-diff action - IDOR protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockGetRepositoryById.mockResolvedValue(repository)
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [{ id: 1 }] })
    mockPoolQuery.mockResolvedValue({ rows: [] })
    mockReverifyDeployment.mockResolvedValue({ changed: true, oldStatus: 'a', newStatus: 'b' })
  })

  it('rejects all mutating actions when the actor lacks admin access to the repository', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    const formData = new FormData()
    formData.set('action', 'apply_reverification')
    formData.set('repository_id', '5')
    formData.set('deployment_id', '42')

    const result = await action({ request: makeRequest(formData), params } as never)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
    expect(mockReverifyDeployment).not.toHaveBeenCalled()
  })

  describe('apply_reverification', () => {
    it('rejects a deployment_id belonging to an app outside the affectedApps scope', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 42, monitored_app_id: 999 }] })

      const formData = new FormData()
      formData.set('action', 'apply_reverification')
      formData.set('repository_id', '5')
      formData.set('deployment_id', '42')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: expect.stringContaining('tilhører ikke dette repositoryet') })
      expect(mockReverifyDeployment).not.toHaveBeenCalled()
    })

    it('reverifies a deployment belonging to an app within the affectedApps scope', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 42, monitored_app_id: 1 }] })

      const formData = new FormData()
      formData.set('action', 'apply_reverification')
      formData.set('repository_id', '5')
      formData.set('deployment_id', '42')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(mockReverifyDeployment).toHaveBeenCalledWith(42)
      expect(result).toEqual(expect.objectContaining({ applied: 42, success: expect.any(String) }))
    })

    it('deletes the diff row and reports success when only PR data was backfilled (status unchanged)', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 42, monitored_app_id: 1 }] })
      mockReverifyDeployment.mockResolvedValue({
        changed: false,
        prBackfilled: true,
        oldStatus: 'approved',
        newStatus: 'approved',
      })

      const formData = new FormData()
      formData.set('action', 'apply_reverification')
      formData.set('repository_id', '5')
      formData.set('deployment_id', '42')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(mockPoolQuery).toHaveBeenCalledWith('DELETE FROM verification_diffs WHERE deployment_id = $1', [42])
      expect(result).toEqual(expect.objectContaining({ applied: 42, success: expect.any(String) }))
    })
  })

  describe('apply_all', () => {
    it('processes in-scope deployments and rejects out-of-scope deployments in a mixed list', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, monitored_app_id: 1 },
          { id: 2, monitored_app_id: 999 },
          { id: 3, monitored_app_id: 1 },
        ],
      })
      mockReverifyDeployment.mockResolvedValueOnce({ changed: true, oldStatus: 'a', newStatus: 'b' })
      mockReverifyDeployment.mockResolvedValueOnce({ changed: false, oldStatus: 'a', newStatus: 'a' })

      const formData = new FormData()
      formData.set('action', 'apply_all')
      formData.set('repository_id', '5')
      formData.append('deployment_ids', '1')
      formData.append('deployment_ids', '2')
      formData.append('deployment_ids', '3')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(mockReverifyDeployment).toHaveBeenCalledTimes(2)
      expect(mockReverifyDeployment).toHaveBeenCalledWith(1)
      expect(mockReverifyDeployment).toHaveBeenCalledWith(3)
      expect(mockReverifyDeployment).not.toHaveBeenCalledWith(2)
      expect(result).toEqual(
        expect.objectContaining({ appliedAll: true, applied: 1, skipped: 1, errors: 1, success: expect.any(String) }),
      )
    })

    it('counts PR-backfill-only results (status unchanged) as applied, not skipped', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, monitored_app_id: 1 }],
      })
      mockReverifyDeployment.mockResolvedValueOnce({
        changed: false,
        prBackfilled: true,
        oldStatus: 'approved',
        newStatus: 'approved',
      })

      const formData = new FormData()
      formData.set('action', 'apply_all')
      formData.set('repository_id', '5')
      formData.append('deployment_ids', '1')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(mockPoolQuery).toHaveBeenCalledWith('DELETE FROM verification_diffs WHERE deployment_id = $1', [1])
      expect(result).toEqual(
        expect.objectContaining({ appliedAll: true, applied: 1, skipped: 0, errors: 0, success: expect.any(String) }),
      )
    })
  })

  describe('check_refresh_status', () => {
    it('rejects a job_id belonging to a different repository', async () => {
      mockGetSyncJobById.mockResolvedValue({ id: 7, repository_id: 999, job_type: 'refresh_missing_approver' })

      const formData = new FormData()
      formData.set('action', 'check_refresh_status')
      formData.set('repository_id', '5')
      formData.set('job_id', '7')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: expect.stringContaining('Fant ikke jobb') })
    })

    it('rejects a job_id of the wrong job_type', async () => {
      mockGetSyncJobById.mockResolvedValue({ id: 7, repository_id: 5, job_type: 'reverify_app' })

      const formData = new FormData()
      formData.set('action', 'check_refresh_status')
      formData.set('repository_id', '5')
      formData.set('job_id', '7')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ error: expect.stringContaining('Fant ikke jobb') })
    })

    it('returns job status for a matching refresh_missing_approver job', async () => {
      const job = { id: 7, repository_id: 5, job_type: 'refresh_missing_approver', status: 'running' }
      mockGetSyncJobById.mockResolvedValue(job)

      const formData = new FormData()
      formData.set('action', 'check_refresh_status')
      formData.set('repository_id', '5')
      formData.set('job_id', '7')

      const result = await action({ request: makeRequest(formData), params } as never)

      expect(result).toEqual({ refreshJobStatus: job })
    })
  })
})

describe('deriveComputeJobState - job state reset on repository navigation (issue #741)', () => {
  it('returns null activeJobId/jobError/jobWarning for no job', () => {
    expect(deriveComputeJobState(null)).toEqual({ activeJobId: null, jobError: null, jobWarning: null })
    expect(deriveComputeJobState(undefined)).toEqual({ activeJobId: null, jobError: null, jobWarning: null })
  })

  it('surfaces activeJobId for a running job', () => {
    expect(deriveComputeJobState({ id: 42, status: 'running' })).toEqual({
      activeJobId: 42,
      jobError: null,
      jobWarning: null,
    })
  })

  it('surfaces jobError for a failed or cancelled job, without an activeJobId', () => {
    expect(deriveComputeJobState({ id: 42, status: 'failed' })).toEqual({
      activeJobId: null,
      jobError: 'Beregning av avvik feilet.',
      jobWarning: null,
    })
    expect(deriveComputeJobState({ id: 42, status: 'cancelled' })).toEqual({
      activeJobId: null,
      jobError: 'Beregning av avvik ble avbrutt.',
      jobWarning: null,
    })
  })

  it('surfaces jobWarning for a completed job with partial results', () => {
    expect(deriveComputeJobState({ id: 42, status: 'completed', result: { errors: 2 } })).toEqual({
      activeJobId: null,
      jobError: null,
      jobWarning: expect.stringContaining('2 feil'),
    })
  })

  it("resets to a different repository's own job state (does not leak the previous repository's job)", () => {
    const previousRepoState = deriveComputeJobState({ id: 42, status: 'running' })
    expect(previousRepoState.activeJobId).toBe(42)

    const nextRepoState = deriveComputeJobState(null)
    expect(nextRepoState).toEqual({ activeJobId: null, jobError: null, jobWarning: null })
  })
})

describe('deriveRefreshJobState - job state reset on repository navigation (issue #741)', () => {
  it('returns null activeJobId/jobError/jobWarning for no job', () => {
    expect(deriveRefreshJobState(null)).toEqual({ activeJobId: null, jobError: null, jobWarning: null })
    expect(deriveRefreshJobState(undefined)).toEqual({ activeJobId: null, jobError: null, jobWarning: null })
  })

  it('surfaces activeJobId for a running job', () => {
    expect(deriveRefreshJobState({ id: 7, status: 'running' })).toEqual({
      activeJobId: 7,
      jobError: null,
      jobWarning: null,
    })
  })

  it('surfaces jobError for a failed or cancelled job, without an activeJobId', () => {
    expect(deriveRefreshJobState({ id: 7, status: 'failed' })).toEqual({
      activeJobId: null,
      jobError: 'Oppdatering av godkjennere feilet.',
      jobWarning: null,
    })
    expect(deriveRefreshJobState({ id: 7, status: 'cancelled' })).toEqual({
      activeJobId: null,
      jobError: 'Oppdatering av godkjennere ble avbrutt.',
      jobWarning: null,
    })
  })

  it('surfaces jobWarning for a completed job with partial results', () => {
    expect(deriveRefreshJobState({ id: 7, status: 'completed', result: { errors: 3 } })).toEqual({
      activeJobId: null,
      jobError: null,
      jobWarning: expect.stringContaining('3 deployment'),
    })
  })

  it("resets to a different repository's own job state (does not leak the previous repository's job)", () => {
    const previousRepoState = deriveRefreshJobState({ id: 7, status: 'running' })
    expect(previousRepoState.activeJobId).toBe(7)

    const nextRepoState = deriveRefreshJobState(null)
    expect(nextRepoState).toEqual({ activeJobId: null, jobError: null, jobWarning: null })
  })
})
