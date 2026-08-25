import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getDerivedCompareDataFromRawSnapshot: vi.fn(),
  getLatestCompareSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  saveCompareRawSnapshot: vi.fn(),
  saveCompareSnapshot: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getCommitsBetween: vi.fn(),
  haveSameCommitTree: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({
  fetchPrFromGitHub: vi.fn(),
  findPrForCommit: vi.fn(),
  getCachedPrData: vi.fn(),
  mapPrDataToVerificationTypes: vi.fn(),
  persistPrSnapshots: vi.fn(),
}))

import {
  getDerivedCompareDataFromRawSnapshot,
  getLatestCompareSnapshot,
  saveCompareSnapshot,
} from '~/db/github-data.server'
import { getCommitsBetween, haveSameCommitTree } from '~/lib/github'
import { fetchCommitsBetween } from '~/lib/verification/fetch-data/commits-between.server'
import { findPrForCommit } from '~/lib/verification/fetch-data/pr-data.server'

const mockGetLatestCompareSnapshot = getLatestCompareSnapshot as Mock
const mockGetDerivedCompareDataFromRawSnapshot = getDerivedCompareDataFromRawSnapshot as Mock
const mockSaveCompareSnapshot = saveCompareSnapshot as Mock
const mockGetCommitsBetween = getCommitsBetween as Mock
const mockHaveSameCommitTree = haveSameCommitTree as Mock
const mockFindPrForCommit = findPrForCommit as Mock

describe('fetchCommitsBetween deriving compare data from raw snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindPrForCommit.mockResolvedValue({ prNumber: null, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
  })

  it('derives compare data from a raw snapshot without calling GitHub when the transformed snapshot is missing/outdated', async () => {
    mockGetLatestCompareSnapshot.mockResolvedValue(null)
    mockGetDerivedCompareDataFromRawSnapshot.mockResolvedValue({
      compare: { status: 'ahead', aheadBy: 1, behindBy: 0, totalCommits: 1, changedFiles: 1, noDiffDetected: false },
      commits: [
        {
          sha: 'aaa111',
          message: 'Fix bug',
          authorUsername: 'developer-a',
          authorDate: '2026-02-20T11:00:00Z',
          committerDate: '2026-02-20T11:05:00Z',
          htmlUrl: 'https://github.com/commit/aaa111',
          isMergeCommit: false,
          parentShas: ['parent0'],
        },
      ],
    })

    const result = await fetchCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha', 'main', '2026-01-01')

    expect(mockGetCommitsBetween).not.toHaveBeenCalled()
    expect(mockSaveCompareSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      'base-sha',
      'head-sha',
      expect.objectContaining({ compare: expect.objectContaining({ status: 'ahead' }) }),
      { source: 'cached' },
    )
    expect(result?.compareSummary.status).toBe('ahead')
    expect(result?.commitsBetween).toHaveLength(1)
  })

  it('recomputes noDiffDetected as true for a derived identical compare', async () => {
    mockGetLatestCompareSnapshot.mockResolvedValue(null)
    mockGetDerivedCompareDataFromRawSnapshot.mockResolvedValue({
      compare: {
        status: 'identical',
        aheadBy: 0,
        behindBy: 0,
        totalCommits: 0,
        changedFiles: 0,
        noDiffDetected: false,
      },
      commits: [],
    })

    const result = await fetchCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha', 'main', '2026-01-01')

    expect(mockHaveSameCommitTree).not.toHaveBeenCalled()
    expect(result?.compareSummary.noDiffDetected).toBe(true)
    expect(mockSaveCompareSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      'base-sha',
      'head-sha',
      expect.objectContaining({ compare: expect.objectContaining({ noDiffDetected: true }) }),
      { source: 'cached' },
    )
  })

  it('falls back to GitHub when neither a transformed snapshot nor a raw snapshot exists', async () => {
    mockGetLatestCompareSnapshot.mockResolvedValue(null)
    mockGetDerivedCompareDataFromRawSnapshot.mockResolvedValue(null)
    mockGetCommitsBetween.mockResolvedValue({
      compareData: {
        compare: { status: 'ahead', aheadBy: 1, behindBy: 0, totalCommits: 1, changedFiles: 1, noDiffDetected: false },
        commits: [],
      },
      rawData: { status: 'ahead', total_commits: 1, commits: [], files: [] },
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      githubRepoId: 999,
    })

    await fetchCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha', 'main', '2026-01-01')

    expect(mockGetCommitsBetween).toHaveBeenCalledWith('navikt', 'nda', 'base-sha', 'head-sha')
  })

  it('does not derive from raw when forceRefresh is set', async () => {
    mockGetCommitsBetween.mockResolvedValue({
      compareData: {
        compare: { status: 'ahead', aheadBy: 1, behindBy: 0, totalCommits: 1, changedFiles: 1, noDiffDetected: false },
        commits: [],
      },
      rawData: { status: 'ahead', total_commits: 1, commits: [], files: [] },
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      githubRepoId: 999,
    })

    await fetchCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha', 'main', '2026-01-01', { forceRefresh: true })

    expect(mockGetLatestCompareSnapshot).not.toHaveBeenCalled()
    expect(mockGetDerivedCompareDataFromRawSnapshot).not.toHaveBeenCalled()
    expect(mockGetCommitsBetween).toHaveBeenCalled()
  })
})
