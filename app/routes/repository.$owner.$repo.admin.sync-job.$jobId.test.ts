import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryAdminAccess,
  mockResolveRepositoryFromParams,
  mockGetSyncJobById,
  mockGetSyncJobLogs,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockGetSyncJobById: vi.fn(),
  mockGetSyncJobLogs: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/authorization.server', () => ({
  resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess,
}))

vi.mock('~/lib/repository-resolution.server', () => ({
  resolveRepositoryFromParams: mockResolveRepositoryFromParams,
}))

vi.mock('~/db/sync-jobs.server', () => ({
  getSyncJobById: mockGetSyncJobById,
  getSyncJobLogs: mockGetSyncJobLogs,
  SYNC_JOB_STATUS_LABELS: {},
  SYNC_JOB_TYPE_LABELS: {},
}))

import { loader } from './repository.$owner.$repo.admin.sync-job.$jobId'

function makeRequest(): Request {
  return new Request('http://localhost/repository/navikt/some-repo/admin/sync-job/5')
}

function makeParams(jobId: string) {
  return { owner: 'navikt', repo: 'some-repo', jobId }
}

describe('repository sync-job detail loader - IDOR protection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'some-repo' })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [] })
    mockGetSyncJobById.mockResolvedValue({
      id: 5,
      repository_id: 5,
      job_type: 'fetch_verification_data',
      status: 'completed',
    })
    mockGetSyncJobLogs.mockResolvedValue([])
  })

  it('returns 400 for a non-numeric job ID without touching authorization or the database', async () => {
    await expect(
      loader({ params: makeParams('not-a-number'), request: makeRequest(), url: new URL(makeRequest().url) } as never),
    ).rejects.toMatchObject({ status: 400 })

    expect(mockResolveRepositoryAdminAccess).not.toHaveBeenCalled()
    expect(mockGetSyncJobById).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not authorized for the repository', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    await expect(
      loader({ params: makeParams('5'), request: makeRequest(), url: new URL(makeRequest().url) } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetSyncJobById).not.toHaveBeenCalled()
  })

  it('returns 404 when the job belongs to a different repository than the URL repository', async () => {
    mockGetSyncJobById.mockResolvedValue({ id: 5, repository_id: 999, job_type: 'fetch_verification_data' })

    await expect(
      loader({ params: makeParams('5'), request: makeRequest(), url: new URL(makeRequest().url) } as never),
    ).rejects.toMatchObject({ status: 404 })

    expect(mockGetSyncJobLogs).not.toHaveBeenCalled()
  })

  it('returns job details when authorized and job belongs to the repository', async () => {
    const result = await loader({
      params: makeParams('5'),
      request: makeRequest(),
      url: new URL(makeRequest().url),
    } as never)

    expect(result.job).toEqual(expect.objectContaining({ id: 5, repository_id: 5 }))
    expect(result.repositoryContext).toEqual({ id: 5, githubOwner: 'navikt', githubRepoName: 'some-repo' })
  })
})
