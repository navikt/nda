import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRepositoryById, mockGetRepositoryByOwnerRepo, mockIsCurrentOrHistoricalNameForRepositoryId } =
  vi.hoisted(() => ({
    mockGetRepositoryById: vi.fn(),
    mockGetRepositoryByOwnerRepo: vi.fn(),
    mockIsCurrentOrHistoricalNameForRepositoryId: vi.fn(),
  }))

vi.mock('~/db/repositories.server', () => ({
  getRepositoryById: mockGetRepositoryById,
  getRepositoryByOwnerRepo: mockGetRepositoryByOwnerRepo,
  isCurrentOrHistoricalNameForRepositoryId: mockIsCurrentOrHistoricalNameForRepositoryId,
}))

import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'

const repository = {
  id: 5,
  github_repo_id: '123',
  github_owner: 'navikt',
  github_repo_name: 'renamed-repo',
  audit_start_year: 2022,
  implicit_approval_mode: 'off' as const,
  default_branch: 'main',
  default_branch_synced_at: null,
}

describe('resolveRepositoryFromParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves existing filters alongside repositoryId when redirecting a mismatched byId lookup', async () => {
    mockGetRepositoryById.mockResolvedValue(repository)
    mockIsCurrentOrHistoricalNameForRepositoryId.mockResolvedValue(true)

    const url = new URL(
      `http://localhost/repository/navikt/some-repo/deployments?repositoryId=${repository.id}&status=success&period=last-week`,
    )

    const thrown = await resolveRepositoryFromParams('navikt', 'some-repo', url, '/deployments').catch((e) => e)

    expect(thrown).toBeInstanceOf(Response)
    expect(thrown.status).toBe(301)
    const location = thrown.headers.get('location')
    expect(location).toContain(`repositoryId=${repository.id}`)
    expect(location).toContain('status=success')
    expect(location).toContain('period=last-week')
  })

  it('preserves existing filters when redirecting a historical name lookup', async () => {
    mockGetRepositoryById.mockResolvedValue(null)
    mockGetRepositoryByOwnerRepo.mockResolvedValue({
      status: 'redirect',
      githubOwner: 'navikt',
      githubRepoName: 'new-repo-name',
    })

    const url = new URL('http://localhost/repository/navikt/old-repo-name/deployments?status=success&period=last-week')

    const thrown = await resolveRepositoryFromParams('navikt', 'old-repo-name', url, '/deployments').catch((e) => e)

    expect(thrown).toBeInstanceOf(Response)
    expect(thrown.status).toBe(301)
    expect(thrown.headers.get('location')).toBe(
      '/repository/navikt/new-repo-name/deployments?status=success&period=last-week',
    )
  })
})
