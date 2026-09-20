import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockCanAccessRepositoryAdmin,
  mockCanAccessRepositoryAdminWithClient,
  mockUpdateRepositorySettingsByRepositoryId,
  mockIsCurrentOrHistoricalNameForRepositoryId,
  mockGetRepositoryById,
  mockAcquireSyncLockForRepository,
  mockCancelSyncJob,
  mockForceReleaseSyncJob,
  mockGetSyncJobById,
  mockReleaseSyncLock,
  mockHeartbeatSyncJob,
  mockUpdateSyncJobProgress,
  mockFetchVerificationDataForRepository,
  mockComputeVerificationDiffsForRepository,
  mockRunWithJobContext,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCanAccessRepositoryAdmin: vi.fn(),
  mockCanAccessRepositoryAdminWithClient: vi.fn(),
  mockUpdateRepositorySettingsByRepositoryId: vi.fn(),
  mockIsCurrentOrHistoricalNameForRepositoryId: vi.fn(),
  mockGetRepositoryById: vi.fn(),
  mockAcquireSyncLockForRepository: vi.fn(),
  mockCancelSyncJob: vi.fn(),
  mockForceReleaseSyncJob: vi.fn(),
  mockGetSyncJobById: vi.fn(),
  mockReleaseSyncLock: vi.fn(),
  mockHeartbeatSyncJob: vi.fn(),
  mockUpdateSyncJobProgress: vi.fn(),
  mockFetchVerificationDataForRepository: vi.fn(),
  mockComputeVerificationDiffsForRepository: vi.fn(),
  mockRunWithJobContext: vi.fn(
    async (
      _jobId: number,
      _jobType: string,
      _target: number | { repositoryId: number },
      _debug: boolean,
      fn: () => Promise<unknown>,
    ) => fn(),
  ),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/authorization.server', () => ({
  canAccessRepositoryAdmin: mockCanAccessRepositoryAdmin,
  canAccessRepositoryAdminWithClient: mockCanAccessRepositoryAdminWithClient,
}))

vi.mock('~/db/repositories.server', () => ({
  updateRepositorySettingsByRepositoryId: mockUpdateRepositorySettingsByRepositoryId,
  isCurrentOrHistoricalNameForRepositoryId: mockIsCurrentOrHistoricalNameForRepositoryId,
  getRepositoryById: mockGetRepositoryById,
}))

vi.mock('~/db/sync-jobs.server', () => ({
  acquireSyncLockForRepository: mockAcquireSyncLockForRepository,
  cancelSyncJob: mockCancelSyncJob,
  forceReleaseSyncJob: mockForceReleaseSyncJob,
  getSyncJobById: mockGetSyncJobById,
  releaseSyncLock: mockReleaseSyncLock,
  heartbeatSyncJob: mockHeartbeatSyncJob,
  updateSyncJobProgress: mockUpdateSyncJobProgress,
}))

vi.mock('~/lib/verification', () => ({
  fetchVerificationDataForRepository: mockFetchVerificationDataForRepository,
}))

vi.mock('~/lib/verification/compute-diffs.server', () => ({
  computeVerificationDiffsForRepository: mockComputeVerificationDiffsForRepository,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  runWithJobContext: mockRunWithJobContext,
}))

vi.mock('~/lib/route-params.server', () => ({
  requireParams: (params: Record<string, string | undefined>, keys: string[]) => {
    const result: Record<string, string> = {}
    for (const key of keys) {
      const value = params[key]
      if (!value) throw new Response(`Missing param ${key}`, { status: 400 })
      result[key] = value
    }
    return result
  },
}))

vi.mock('~/lib/form-validators', () => ({
  getFormString: (formData: FormData, key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  },
}))

vi.mock('~/lib/verification/types', () => ({
  isImplicitApprovalMode: (value: string) => value === 'off' || value === 'dependabot_only' || value === 'all',
}))

import {
  action,
  processComputeDiffsJobForRepositoryAsync,
  processFetchDataJobForRepositoryAsync,
} from './repository.$owner.$repo.admin.actions.server'

const REPO_PARAMS = { owner: 'navikt', repo: 'some-repo' }

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/repository/navikt/some-repo/admin', {
    method: 'POST',
    body: formData,
  })
}

function callAction(formData: FormData) {
  return action({ request: makeRequest(formData), params: REPO_PARAMS } as never)
}

describe('repository admin actions - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockCanAccessRepositoryAdmin.mockResolvedValue(true)
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
  })

  it('resolves the repository from the submitted repository_id and authorizes with its id', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['default_branch'],
    })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    await callAction(formData)

    expect(mockGetRepositoryById).toHaveBeenCalledWith(5)
    expect(mockIsCurrentOrHistoricalNameForRepositoryId).toHaveBeenCalledWith(5, 'navikt', 'some-repo')
    expect(mockCanAccessRepositoryAdmin).toHaveBeenCalledWith(expect.anything(), 5)
  })

  it('rejects when the submitted repository_id does not resolve to the repository in the URL', async () => {
    mockGetRepositoryById.mockResolvedValue({ id: 999, github_owner: 'navikt', github_repo_name: 'other-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '999')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Repository-ID samsvarer ikke med repositoryet i URL-en' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('rejects when the submitted repository_id does not exist', async () => {
    mockGetRepositoryById.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Fant ikke repositoryet' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
  })

  it('accepts the URL when it uses a historical (renamed) owner/repo for the submitted repository_id', async () => {
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'renamed-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['default_branch'],
    })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(mockCanAccessRepositoryAdmin).toHaveBeenCalledWith(expect.anything(), 5)
    expect(result).toEqual({ success: expect.stringContaining('Default branch oppdatert') })
  })

  it('rejects when the URL owner/repo cannot be resolved to the submitted repository at all', async () => {
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'renamed-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Repository-ID samsvarer ikke med repositoryet i URL-en' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
  })

  it('rejects when the actor lacks admin access to the repository', async () => {
    mockCanAccessRepositoryAdmin.mockResolvedValue(false)

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['not-a-number', 'not-a-number'],
    ['5abc', '5abc'],
    ['5.9', '5.9'],
  ])('rejects an invalid repository_id (%s)', async (_label, value) => {
    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    if (value !== undefined) formData.set('repository_id', value)
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig eller manglende repository-ID' })
    expect(mockCanAccessRepositoryAdmin).not.toHaveBeenCalled()
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('successfully updates the default branch', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['default_branch'],
    })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(mockUpdateRepositorySettingsByRepositoryId).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 5, patch: { defaultBranch: 'main' } }),
    )
    expect(result).toEqual({ success: expect.stringContaining('Default branch oppdatert') })
  })

  it('rejects a default_branch value longer than 255 characters', async () => {
    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'x'.repeat(256))

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Default branch kan ikke være lengre enn 255 tegn' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('successfully updates the implicit approval mode', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['implicit_approval'],
    })

    const formData = new FormData()
    formData.set('action', 'update_implicit_approval')
    formData.set('repository_id', '5')
    formData.set('mode', 'all')

    const result = await callAction(formData)

    expect(mockUpdateRepositorySettingsByRepositoryId).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 5, patch: { implicitApprovalMode: 'all' } }),
    )
    expect(result).toEqual({ success: expect.stringContaining('Implisitt godkjenning') })
  })

  it('successfully updates the audit start year', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({
      ok: true,
      repositoryId: 5,
      affectedApps: [],
      changedKeys: ['audit_start_year'],
    })

    const formData = new FormData()
    formData.set('action', 'update_audit_start_year')
    formData.set('repository_id', '5')
    formData.set('audit_start_year', '2022')

    const result = await callAction(formData)

    expect(mockUpdateRepositorySettingsByRepositoryId).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 5, patch: { auditStartYear: 2022 } }),
    )
    expect(result).toEqual({ success: expect.stringContaining('oppdatert') })
  })

  it('maps repo_not_found to a not-found message', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({ ok: false, reason: 'repo_not_found' })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Fant ikke repositoryet' })
  })

  it('maps repo_not_linked to a distinct message', async () => {
    mockUpdateRepositorySettingsByRepositoryId.mockResolvedValue({ ok: false, reason: 'repo_not_linked' })

    const formData = new FormData()
    formData.set('action', 'update_default_branch')
    formData.set('repository_id', '5')
    formData.set('default_branch', 'main')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Repositoryet er ikke lenger koblet til noen aktiv app' })
  })

  it('rejects update_implicit_approval with an invalid mode', async () => {
    const formData = new FormData()
    formData.set('action', 'update_implicit_approval')
    formData.set('repository_id', '5')
    formData.set('mode', 'not-a-real-mode')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig modus' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('rejects update_audit_start_year with an out-of-range year', async () => {
    const formData = new FormData()
    formData.set('action', 'update_audit_start_year')
    formData.set('repository_id', '5')
    formData.set('audit_start_year', '1800')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ugyldig startår. Må være mellom 2000 og 2100.' })
    expect(mockUpdateRepositorySettingsByRepositoryId).not.toHaveBeenCalled()
  })

  it('returns an error for an unknown action', async () => {
    const formData = new FormData()
    formData.set('action', 'not_a_real_action')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Ukjent handling' })
  })
})

describe('repository admin actions - fetch verification data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockCanAccessRepositoryAdmin.mockResolvedValue(true)
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
  })

  it('starts a repository-scoped fetch job when the lock is available', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue(42)
    mockFetchVerificationDataForRepository.mockResolvedValue({ total: 0, processed: 0 })

    const formData = new FormData()
    formData.set('action', 'fetch_verification_data')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(mockAcquireSyncLockForRepository).toHaveBeenCalledWith(
      'fetch_verification_data',
      5,
      5,
      undefined,
      expect.any(Function),
    )
    expect(result).toEqual({ fetchJobStarted: 42 })
  })

  it('returns an error when a fetch job is already running for the repository', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('action', 'fetch_verification_data')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'En datahenting kjører allerede for dette repositoryet' })
  })

  it('returns a distinct error when blocked by a running app-scoped job', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue('app_conflict')

    const formData = new FormData()
    formData.set('action', 'fetch_verification_data')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'En datahenting kjører allerede for en app i dette repositoryet' })
  })

  it('returns an error when access is revoked before the lock is acquired', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue('unauthorized')

    const formData = new FormData()
    formData.set('action', 'fetch_verification_data')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
  })

  it('cancels a running fetch job scoped to this repository', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 5 })
    mockCancelSyncJob.mockResolvedValue(true)

    const formData = new FormData()
    formData.set('action', 'cancel_fetch_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(mockCancelSyncJob).toHaveBeenCalledWith(42, expect.any(Function))
    expect(result).toEqual({ success: 'Jobben ble avbrutt' })
  })

  it('rejects cancel_fetch_job for a job belonging to a different repository', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 999 })

    const formData = new FormData()
    formData.set('action', 'cancel_fetch_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke tilgang til denne jobben' })
    expect(mockCancelSyncJob).not.toHaveBeenCalled()
  })

  it('returns an error when access is revoked before cancel_fetch_job commits', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 5 })
    mockCancelSyncJob.mockResolvedValue('unauthorized')

    const formData = new FormData()
    formData.set('action', 'cancel_fetch_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
  })

  it('force-releases a job scoped to this repository', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 5 })
    mockForceReleaseSyncJob.mockResolvedValue(true)

    const formData = new FormData()
    formData.set('action', 'force_release_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(mockForceReleaseSyncJob).toHaveBeenCalledWith(42, expect.any(Function))
    expect(result).toEqual({ success: 'Jobben ble tvangsfrigjort' })
  })

  it('returns an error when access is revoked before force_release_job commits', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 5 })
    mockForceReleaseSyncJob.mockResolvedValue('unauthorized')

    const formData = new FormData()
    formData.set('action', 'force_release_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
  })
})

describe('repository admin actions - compute diffs (reverify)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockCanAccessRepositoryAdmin.mockResolvedValue(true)
    mockGetRepositoryById.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)
  })

  it('starts a repository-scoped compute-diffs job when the lock is available', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue(42)
    mockComputeVerificationDiffsForRepository.mockResolvedValue({
      deploymentsChecked: 0,
      diffsFound: 0,
      skipped: 0,
      errors: 0,
      appsProcessed: 0,
      appsTotal: 0,
    })

    const formData = new FormData()
    formData.set('action', 'compute_diffs')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(mockAcquireSyncLockForRepository).toHaveBeenCalledWith(
      'reverify_app',
      5,
      10,
      undefined,
      expect.any(Function),
    )
    expect(result).toEqual({ computeDiffsJobStarted: 42 })
  })

  it('returns an error when a compute-diffs job is already running for the repository', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue(null)

    const formData = new FormData()
    formData.set('action', 'compute_diffs')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'En reverifisering kjører allerede for dette repositoryet' })
  })

  it('returns a distinct error when blocked by a running app-scoped reverify job', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue('app_conflict')

    const formData = new FormData()
    formData.set('action', 'compute_diffs')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'En reverifisering kjører allerede for en app i dette repositoryet' })
  })

  it('returns an error when access is revoked before the lock is acquired', async () => {
    mockAcquireSyncLockForRepository.mockResolvedValue('unauthorized')

    const formData = new FormData()
    formData.set('action', 'compute_diffs')
    formData.set('repository_id', '5')

    const result = await callAction(formData)

    expect(result).toEqual({ error: 'Du har ikke administratortilgang til alle appene i dette repoet' })
  })

  it('cancels a running compute-diffs job scoped to this repository', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 5 })
    mockCancelSyncJob.mockResolvedValue(true)

    const formData = new FormData()
    formData.set('action', 'cancel_compute_diffs_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(mockCancelSyncJob).toHaveBeenCalledWith(42, expect.any(Function))
    expect(result).toEqual({ success: 'Jobben ble avbrutt' })
  })

  it('force-releases a compute-diffs job scoped to this repository', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 42, repository_id: 5 })
    mockForceReleaseSyncJob.mockResolvedValue(true)

    const formData = new FormData()
    formData.set('action', 'force_release_compute_diffs_job')
    formData.set('repository_id', '5')
    formData.set('job_id', '42')

    const result = await callAction(formData)

    expect(mockForceReleaseSyncJob).toHaveBeenCalledWith(42, expect.any(Function))
    expect(result).toEqual({ success: 'Jobben ble tvangsfrigjort' })
  })
})

describe('processComputeDiffsJobForRepositoryAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunWithJobContext.mockImplementation(
      async (
        _jobId: number,
        _jobType: string,
        _target: number | { repositoryId: number },
        _debug: boolean,
        fn: () => Promise<unknown>,
      ) => fn(),
    )
    mockGetSyncJobById.mockResolvedValue({ id: 5, repository_id: 7, status: 'running' })
  })

  it('releases the sync lock as "completed" when compute diffs finishes', async () => {
    mockComputeVerificationDiffsForRepository.mockResolvedValue({
      deploymentsChecked: 12,
      diffsFound: 2,
      skipped: 0,
      errors: 0,
      appsProcessed: 3,
      appsTotal: 3,
    })

    await processComputeDiffsJobForRepositoryAsync(5, 7)

    expect(mockReleaseSyncLock).toHaveBeenCalledWith(5, 'completed', expect.objectContaining({ diffsFound: 2 }))
  })

  it('releases the sync lock as "failed" when compute diffs throws', async () => {
    mockComputeVerificationDiffsForRepository.mockRejectedValue(new Error('boom'))

    await expect(processComputeDiffsJobForRepositoryAsync(5, 7)).rejects.toThrow('boom')

    expect(mockReleaseSyncLock).toHaveBeenCalledWith(5, 'failed', undefined, 'boom')
  })

  it('does not release the lock when the job was already cancelled', async () => {
    mockComputeVerificationDiffsForRepository.mockResolvedValue({
      deploymentsChecked: 0,
      diffsFound: 0,
      skipped: 0,
      errors: 0,
      appsProcessed: 0,
      appsTotal: 0,
    })
    mockGetSyncJobById.mockResolvedValue({ id: 5, repository_id: 7, status: 'cancelled' })

    await processComputeDiffsJobForRepositoryAsync(5, 7)

    expect(mockReleaseSyncLock).not.toHaveBeenCalled()
  })
})

describe('processFetchDataJobForRepositoryAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunWithJobContext.mockImplementation(
      async (
        _jobId: number,
        _jobType: string,
        _target: number | { repositoryId: number },
        _debug: boolean,
        fn: () => Promise<unknown>,
      ) => fn(),
    )
    mockGetSyncJobById.mockResolvedValue({ id: 5, repository_id: 7, status: 'running' })
  })

  it('releases the sync lock as "partial" when the bulk fetch reports rateLimited', async () => {
    mockFetchVerificationDataForRepository.mockResolvedValue({
      total: 10,
      processed: 3,
      skipped: 0,
      fetched: 3,
      derivedFromRaw: 0,
      workflowTriggersFetched: 0,
      errors: 0,
      errorDetails: [],
      rateLimited: true,
    })

    await processFetchDataJobForRepositoryAsync(5, 7)

    expect(mockReleaseSyncLock).toHaveBeenCalledWith(5, 'partial', expect.objectContaining({ rateLimited: true }))
  })

  it('releases the sync lock as "completed" when the bulk fetch finishes without hitting the rate limit', async () => {
    mockFetchVerificationDataForRepository.mockResolvedValue({
      total: 10,
      processed: 10,
      skipped: 0,
      fetched: 10,
      derivedFromRaw: 0,
      workflowTriggersFetched: 0,
      errors: 0,
      errorDetails: [],
    })

    await processFetchDataJobForRepositoryAsync(5, 7)

    expect(mockReleaseSyncLock).toHaveBeenCalledWith(5, 'completed', expect.anything())
  })
})
