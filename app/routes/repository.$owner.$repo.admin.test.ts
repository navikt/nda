import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryAdminAccess,
  mockGetRepositoryByOwnerRepo,
  mockGetRepositoryById,
  mockGetRepoConfigAuditLog,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetRepositoryByOwnerRepo: vi.fn(),
  mockGetRepositoryById: vi.fn(),
  mockGetRepoConfigAuditLog: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/authorization.server', () => ({
  resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess,
}))

vi.mock('~/db/repositories.server', () => ({
  getRepositoryByOwnerRepo: mockGetRepositoryByOwnerRepo,
  getRepositoryById: mockGetRepositoryById,
  getRepoConfigAuditLog: mockGetRepoConfigAuditLog,
}))

import { loader } from './repository.$owner.$repo.admin'

function makeRequest(search = ''): Request {
  return new Request(`http://localhost/repository/navikt/some-repo/admin${search}`)
}

const repository = {
  id: 5,
  github_repo_id: '123',
  github_owner: 'navikt',
  github_repo_name: 'some-repo',
  audit_start_year: 2022,
  implicit_approval_mode: 'off',
  default_branch: 'main',
  default_branch_synced_at: null,
}

describe('repository admin loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [] })
    mockGetRepositoryById.mockResolvedValue(null)
    mockGetRepoConfigAuditLog.mockResolvedValue([])
  })

  it('throws 403 when the user lacks repository-admin access', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'found', repository })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    await expect(
      loader({ params: { owner: 'navikt', repo: 'some-repo' }, request: makeRequest() } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetRepoConfigAuditLog).not.toHaveBeenCalled()
  })

  it('returns repository data for an authorized current-name lookup', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'found', repository })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [] })

    const result = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest(),
    } as never)

    expect(result.repository).toEqual({
      id: repository.id,
      github_owner: repository.github_owner,
      github_repo_name: repository.github_repo_name,
    })
    expect(mockResolveRepositoryAdminAccess).toHaveBeenCalledWith(expect.anything(), repository.id)
  })

  it('marks the repository as not linked when it has no affected apps (e.g. an orphaned repo an entra admin can reach)', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'found', repository })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [] })

    const result = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest(),
    } as never)

    expect(result.isLinked).toBe(false)
  })

  it('marks the repository as linked when it has at least one affected app', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'found', repository })
    mockResolveRepositoryAdminAccess.mockResolvedValue({
      authorized: true,
      affectedApps: [{ id: 1, app_name: 'repo-e', team_slug: 'nais-repo-e', environment_name: 'prod-gcp' }],
    })

    const result = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest(),
    } as never)

    expect(result.isLinked).toBe(true)
  })

  it('redirects with 301 when the repo was found via historical name', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({
      status: 'redirect',
      githubOwner: 'navikt',
      githubRepoName: 'new-repo-name',
    })

    const thrown = await loader({
      params: { owner: 'navikt', repo: 'old-repo-name' },
      request: makeRequest(),
    } as never).catch((e) => e)

    expect(thrown).toBeInstanceOf(Response)
    expect(thrown.status).toBe(301)
    expect(thrown.headers.get('location')).toBe('/repository/navikt/new-repo-name/admin')
    expect(mockResolveRepositoryAdminAccess).not.toHaveBeenCalled()
  })

  it('throws 404 when the repository is not found', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'not_found' })

    await expect(
      loader({ params: { owner: 'navikt', repo: 'missing-repo' }, request: makeRequest() } as never),
    ).rejects.toMatchObject({ status: 404 })

    expect(mockResolveRepositoryAdminAccess).not.toHaveBeenCalled()
  })

  it('resolves the repository by immutable id when repositoryId is given and names match', async () => {
    mockGetRepositoryById.mockResolvedValue(repository)

    const result = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest(`?repositoryId=${repository.id}`),
    } as never)

    expect(mockGetRepositoryById).toHaveBeenCalledWith(repository.id)
    expect(mockGetRepositoryByOwnerRepo).not.toHaveBeenCalled()
    expect(result.repository).toEqual({
      id: repository.id,
      github_owner: repository.github_owner,
      github_repo_name: repository.github_repo_name,
    })
  })

  it('redirects with 301 when repositoryId resolves to a repository with different current names', async () => {
    mockGetRepositoryById.mockResolvedValue({
      ...repository,
      github_owner: 'navikt',
      github_repo_name: 'renamed-repo',
    })

    const thrown = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest(`?repositoryId=${repository.id}`),
    } as never).catch((e) => e)

    expect(thrown).toBeInstanceOf(Response)
    expect(thrown.status).toBe(301)
    expect(thrown.headers.get('location')).toBe(`/repository/navikt/renamed-repo/admin?repositoryId=${repository.id}`)
    expect(mockResolveRepositoryAdminAccess).not.toHaveBeenCalled()
  })

  it('falls back to name-based lookup when repositoryId does not resolve to a repository', async () => {
    mockGetRepositoryById.mockResolvedValue(null)
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'found', repository })

    const result = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest('?repositoryId=999999'),
    } as never)

    expect(mockGetRepositoryById).toHaveBeenCalledWith(999999)
    expect(mockGetRepositoryByOwnerRepo).toHaveBeenCalledWith('navikt', 'some-repo')
    expect(result.repository.id).toBe(repository.id)
  })

  it('falls back to name-based lookup when repositoryId is not a valid number', async () => {
    mockGetRepositoryByOwnerRepo.mockResolvedValue({ status: 'found', repository })

    const result = await loader({
      params: { owner: 'navikt', repo: 'some-repo' },
      request: makeRequest('?repositoryId=not-a-number'),
    } as never)

    expect(mockGetRepositoryById).not.toHaveBeenCalled()
    expect(mockGetRepositoryByOwnerRepo).toHaveBeenCalledWith('navikt', 'some-repo')
    expect(result.repository.id).toBe(repository.id)
  })
})
