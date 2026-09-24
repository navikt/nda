import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkflowRun, mockGetLatestWorkflowRunRawSnapshot, mockSaveWorkflowRunRawSnapshot } = vi.hoisted(() => ({
  mockGetWorkflowRun: vi.fn(),
  mockGetLatestWorkflowRunRawSnapshot: vi.fn(),
  mockSaveWorkflowRunRawSnapshot: vi.fn(),
}))

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    actions: {
      getWorkflowRun: mockGetWorkflowRun,
    },
  }),
}))

vi.mock('~/db/github-data.server', () => ({
  getLatestWorkflowRunRawSnapshot: mockGetLatestWorkflowRunRawSnapshot,
  saveWorkflowRunRawSnapshot: mockSaveWorkflowRunRawSnapshot,
  saveCommitRawSnapshot: vi.fn(),
  saveCompareRawSnapshot: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { resolveGithubRepoIdFromWorkflowRunDetailed } from '~/lib/github/git.server'

describe('resolveGithubRepoIdFromWorkflowRunDetailed', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset()
    mockGetLatestWorkflowRunRawSnapshot.mockReset()
    mockSaveWorkflowRunRawSnapshot.mockReset()
  })

  it('reports a permanent failure when there is no run id in the trigger_url', async () => {
    const result = await resolveGithubRepoIdFromWorkflowRunDetailed('navikt', 'nda', 'https://example.com/no-run-id')

    expect(result).toEqual({ repositoryId: null, permanentFailure: true })
  })

  it('reports a permanent failure on 404 (workflow run not found)', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce(null)
    mockGetWorkflowRun.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))

    const result = await resolveGithubRepoIdFromWorkflowRunDetailed(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toEqual({ repositoryId: null, permanentFailure: true })
  })

  it('reports a transient failure on unexpected API errors (network, rate limit, 5xx)', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce(null)
    mockGetWorkflowRun.mockRejectedValueOnce(new Error('network error'))

    const result = await resolveGithubRepoIdFromWorkflowRunDetailed(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toEqual({ repositoryId: null, permanentFailure: false })
  })

  it('reports success (not a permanent failure) when the repository id resolves', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce(null)
    mockGetWorkflowRun.mockResolvedValueOnce({
      headers: {},
      data: { repository: { id: 42 } },
    })

    const result = await resolveGithubRepoIdFromWorkflowRunDetailed(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toEqual({ repositoryId: 42, permanentFailure: false })
  })

  it('re-extracts the repository id from the cached snapshot payload rather than trusting the stored column', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce({
      id: 1,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      runId: 12345,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt: new Date(),
      data: { repository: { id: 42 } },
    })

    const result = await resolveGithubRepoIdFromWorkflowRunDetailed(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toEqual({ repositoryId: 42, permanentFailure: false })
    expect(mockGetWorkflowRun).not.toHaveBeenCalled()
  })

  it('falls through to a live lookup when a legacy cached snapshot has no repository.id in its raw payload, instead of returning a stuck permanentFailure:false result', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce({
      id: 1,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      runId: 12345,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt: new Date(),
      data: { some: 'payload without a repository field' },
    })
    mockGetWorkflowRun.mockResolvedValueOnce({
      headers: {},
      data: { repository: { id: 42 } },
    })

    const result = await resolveGithubRepoIdFromWorkflowRunDetailed(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toEqual({ repositoryId: 42, permanentFailure: false })
    expect(mockGetWorkflowRun).toHaveBeenCalledOnce()
    expect(mockSaveWorkflowRunRawSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      42,
      12345,
      expect.anything(),
      expect.anything(),
    )
  })
})
