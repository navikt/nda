import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveRepositoryFromParams,
  mockGetAllAppsLinkedToRepositoryId,
  mockGetUserIdentity,
  mockGetMultiAppDeploymentsPageData,
} = vi.hoisted(() => ({
  mockResolveRepositoryFromParams: vi.fn(),
  mockGetAllAppsLinkedToRepositoryId: vi.fn(),
  mockGetUserIdentity: vi.fn(),
  mockGetMultiAppDeploymentsPageData: vi.fn(),
}))

vi.mock('~/lib/repository-resolution.server', () => ({
  resolveRepositoryFromParams: mockResolveRepositoryFromParams,
}))

vi.mock('~/db/repositories.server', () => ({
  getAllAppsLinkedToRepositoryId: mockGetAllAppsLinkedToRepositoryId,
}))

vi.mock('~/lib/auth.server', () => ({
  getUserIdentity: mockGetUserIdentity,
}))

vi.mock('~/lib/deployments/multi-app-deployments.server', () => ({
  getMultiAppDeploymentsPageData: mockGetMultiAppDeploymentsPageData,
}))

import { loader } from './repository.$owner.$repo.deployments'

const repository = {
  id: 5,
  github_repo_id: '123',
  github_owner: 'navikt',
  github_repo_name: 'some-repo',
  audit_start_year: 2022,
  implicit_approval_mode: 'off' as const,
  default_branch: 'main',
  default_branch_synced_at: null,
}

const linkedApp = {
  id: 1,
  app_name: 'repo-app',
  team_slug: 'nais-repo-app',
  environment_name: 'prod-gcp',
  is_active: true,
}

function makeArgs(search = '') {
  const url = new URL(`http://localhost/repository/navikt/some-repo/deployments${search}`)
  return { params: { owner: 'navikt', repo: 'some-repo' }, request: new Request(url), url } as never
}

describe('repository deployments loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockGetUserIdentity.mockResolvedValue(null)
  })

  it('returns empty defaults without querying deployments when no apps are linked', async () => {
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([])

    const result = await loader(makeArgs())

    expect(result.deployments).toEqual([])
    expect(result.total_pages).toBe(0)
    expect(mockGetMultiAppDeploymentsPageData).not.toHaveBeenCalled()
  })

  it('clamps a non-positive page value to 1 before querying deployments', async () => {
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([linkedApp])
    mockGetMultiAppDeploymentsPageData.mockResolvedValue({ deployments: [], total: 0, page: 1, total_pages: 0 })

    await loader(makeArgs('?page=-1'))

    expect(mockGetMultiAppDeploymentsPageData).toHaveBeenCalledWith(
      [linkedApp],
      expect.objectContaining({ page: 1 }),
      null,
    )
  })

  it('clamps a non-numeric page value to 1 before querying deployments', async () => {
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([linkedApp])
    mockGetMultiAppDeploymentsPageData.mockResolvedValue({ deployments: [], total: 0, page: 1, total_pages: 0 })

    await loader(makeArgs('?page=not-a-number'))

    expect(mockGetMultiAppDeploymentsPageData).toHaveBeenCalledWith(
      [linkedApp],
      expect.objectContaining({ page: 1 }),
      null,
    )
  })

  it('redirects to the last page when the requested page exceeds total_pages', async () => {
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([linkedApp])
    mockGetMultiAppDeploymentsPageData.mockResolvedValue({ deployments: [], total: 40, page: 5, total_pages: 2 })

    const thrown = await loader(makeArgs('?page=5')).catch((e) => e)

    expect(thrown).toBeInstanceOf(Response)
    expect(thrown.status).toBe(302)
    expect(thrown.headers.get('location')).toBe('/repository/navikt/some-repo/deployments?page=2')
  })

  it('returns repository merged with the deployment data on success', async () => {
    mockGetAllAppsLinkedToRepositoryId.mockResolvedValue([linkedApp])
    mockGetMultiAppDeploymentsPageData.mockResolvedValue({
      deployments: [{ id: 1 }],
      total: 1,
      page: 1,
      total_pages: 1,
    })

    const result = await loader(makeArgs())

    expect(result.repository).toBe(repository)
    expect(result.deployments).toEqual([{ id: 1 }])
  })
})
