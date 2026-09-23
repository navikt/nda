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

import { hasResolvableWorkflowRunId, resolveGithubRepoIdFromWorkflowRun } from '~/lib/github/git.server'

describe('hasResolvableWorkflowRunId', () => {
  it('returns true when triggerUrl contains a workflow run id', () => {
    expect(hasResolvableWorkflowRunId('https://github.com/navikt/nda/actions/runs/12345')).toBe(true)
  })

  it('returns false when triggerUrl has no run id', () => {
    expect(hasResolvableWorkflowRunId('https://example.com/no-run-id')).toBe(false)
  })

  it('returns false when triggerUrl is null or undefined', () => {
    expect(hasResolvableWorkflowRunId(null)).toBe(false)
    expect(hasResolvableWorkflowRunId(undefined)).toBe(false)
  })
})

describe('resolveGithubRepoIdFromWorkflowRun', () => {
  beforeEach(() => {
    mockGetWorkflowRun.mockReset()
    mockGetLatestWorkflowRunRawSnapshot.mockReset()
    mockSaveWorkflowRunRawSnapshot.mockReset()
  })

  it('returns null when the trigger_url has no run id', async () => {
    const result = await resolveGithubRepoIdFromWorkflowRun('navikt', 'nda', 'https://example.com/no-run-id')

    expect(result).toBeNull()
    expect(mockGetWorkflowRun).not.toHaveBeenCalled()
  })

  it('returns null when trigger_url is null', async () => {
    const result = await resolveGithubRepoIdFromWorkflowRun('navikt', 'nda', null)

    expect(result).toBeNull()
    expect(mockGetWorkflowRun).not.toHaveBeenCalled()
  })

  it('resolves the repository id from a cached raw snapshot without calling the API', async () => {
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

    const result = await resolveGithubRepoIdFromWorkflowRun(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toBe(42)
    expect(mockGetWorkflowRun).not.toHaveBeenCalled()
  })

  it('falls back to a live API call when there is no usable cached snapshot', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce(null)
    mockGetWorkflowRun.mockResolvedValueOnce({
      headers: {},
      data: { repository: { id: 42 } },
    })

    const result = await resolveGithubRepoIdFromWorkflowRun(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toBe(42)
    expect(mockGetWorkflowRun).toHaveBeenCalledWith({ owner: 'navikt', repo: 'nda', run_id: 12345 })
    expect(mockSaveWorkflowRunRawSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      42,
      12345,
      { repository: { id: 42 } },
      expect.anything(),
    )
  })

  it('returns null and does not throw when the workflow run is not found (404)', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce(null)
    mockGetWorkflowRun.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))

    const result = await resolveGithubRepoIdFromWorkflowRun(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toBeNull()
    expect(mockSaveWorkflowRunRawSnapshot).not.toHaveBeenCalled()
  })

  it('returns null and does not throw on unexpected API errors', async () => {
    mockGetLatestWorkflowRunRawSnapshot.mockResolvedValueOnce(null)
    mockGetWorkflowRun.mockRejectedValueOnce(new Error('network error'))

    const result = await resolveGithubRepoIdFromWorkflowRun(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
    )

    expect(result).toBeNull()
  })
})
