import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryAdminAccess,
  mockGetSyncJobsForRepository,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetSyncJobsForRepository: vi.fn(),
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

vi.mock('~/db/sync-jobs.server', () => ({
  getSyncJobsForRepository: mockGetSyncJobsForRepository,
}))

import { loader } from './repository.$owner.$repo.admin.sync-jobs'

const params = { owner: 'navikt', repo: 'mulighetsrommet' }

function makeRequest(): Request {
  return new Request('http://localhost/repository/navikt/mulighetsrommet/admin/sync-jobs')
}

const repository = { id: 5, github_owner: 'navikt', github_repo_name: 'mulighetsrommet' }

describe('repository sync-jobs loader - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [{ id: 1 }] })
    mockGetSyncJobsForRepository.mockResolvedValue([])
  })

  it('throws 403 and skips fetching sync jobs when not authorized', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })
    const request = makeRequest()

    await expect(loader({ params, request } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetSyncJobsForRepository).not.toHaveBeenCalled()
  })

  it('returns repo-scoped sync jobs when authorized', async () => {
    const request = makeRequest()

    const result = await loader({ params, request } as never)

    expect(mockGetSyncJobsForRepository).toHaveBeenCalledWith(5, { limit: 200 })
    expect(result.jobs).toEqual([])
    expect(result.repositoryContext).toEqual({
      id: 5,
      githubOwner: 'navikt',
      githubRepoName: 'mulighetsrommet',
    })
  })
})
