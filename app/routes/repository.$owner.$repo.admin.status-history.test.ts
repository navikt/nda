import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryAdminAccess,
  mockGetDeploymentsWithStatusChangesForApps,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetDeploymentsWithStatusChangesForApps: vi.fn(),
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

vi.mock('~/db/deployments.server', () => ({
  getDeploymentsWithStatusChangesForApps: mockGetDeploymentsWithStatusChangesForApps,
}))

import { loader } from './repository.$owner.$repo.admin.status-history'

const params = { owner: 'navikt', repo: 'mulighetsrommet' }

function makeRequest(): Request {
  return new Request('http://localhost/repository/navikt/mulighetsrommet/admin/status-history')
}

const repository = { id: 5, github_owner: 'navikt', github_repo_name: 'mulighetsrommet' }

describe('repository status-history loader - authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockResolveRepositoryAdminAccess.mockResolvedValue({
      authorized: true,
      affectedApps: [{ id: 1 }, { id: 2 }],
    })
    mockGetDeploymentsWithStatusChangesForApps.mockResolvedValue([])
  })

  it('throws 403 and skips fetching status history when not authorized', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })
    const request = makeRequest()

    await expect(loader({ params, request } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetDeploymentsWithStatusChangesForApps).not.toHaveBeenCalled()
  })

  it('returns status history aggregated across all apps linked to the repository', async () => {
    const request = makeRequest()

    const result = await loader({ params, request } as never)

    expect(mockGetDeploymentsWithStatusChangesForApps).toHaveBeenCalledWith([1, 2], 5)
    expect(result.deployments).toEqual([])
    expect(result.repositoryContext).toEqual({
      id: 5,
      githubOwner: 'navikt',
      githubRepoName: 'mulighetsrommet',
    })
  })
})
