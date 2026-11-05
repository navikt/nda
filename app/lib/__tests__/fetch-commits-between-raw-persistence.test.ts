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
  fetchOrRefreshMergedPrData: vi.fn(),
  fetchPrFromGitHub: vi.fn(),
  findPrForCommit: vi.fn(),
  getCachedPrData: vi.fn(),
  mapPrDataToVerificationTypes: vi.fn(),
  persistPrSnapshots: vi.fn(),
}))

import {
  getDerivedCompareDataFromRawSnapshot,
  getLatestCompareSnapshot,
  saveCompareRawSnapshot,
  saveCompareSnapshot,
} from '~/db/github-data.server'
import { getCommitsBetween, haveSameCommitTree } from '~/lib/github'
import { buildCommitsBetweenFromCache, fetchCommitsBetween } from '~/lib/verification/fetch-data/commits-between.server'
import { fetchOrRefreshMergedPrData, findPrForCommit } from '~/lib/verification/fetch-data/pr-data.server'
import type { CompareData } from '~/lib/verification/types'

const mockGetLatestCompareSnapshot = getLatestCompareSnapshot as Mock
const mockGetDerivedCompareDataFromRawSnapshot = getDerivedCompareDataFromRawSnapshot as Mock
const mockSaveCompareSnapshot = saveCompareSnapshot as Mock
const mockSaveCompareRawSnapshot = saveCompareRawSnapshot as Mock
const mockGetCommitsBetween = getCommitsBetween as Mock
const mockHaveSameCommitTree = haveSameCommitTree as Mock

describe('fetchCommitsBetween raw persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLatestCompareSnapshot.mockResolvedValue(null)
    mockGetDerivedCompareDataFromRawSnapshot.mockResolvedValue(null)
  })

  it('persists the raw compare response alongside the transformed snapshot', async () => {
    const rawData = { status: 'ahead', total_commits: 1, commits: [], files: [] }
    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    mockGetCommitsBetween.mockResolvedValue({
      compareData: {
        compare: { status: 'ahead', aheadBy: 1, behindBy: 0, totalCommits: 1, changedFiles: 1, noDiffDetected: false },
        commits: [],
      },
      rawData,
      apiVersion,
      githubRepoId: 999,
    })

    await fetchCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha', 'main', '2026-01-01')

    expect(mockSaveCompareSnapshot).toHaveBeenCalled()
    expect(mockSaveCompareRawSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      999,
      'base-sha',
      'head-sha',
      rawData,
      apiVersion,
    )
  })

  it('persists the raw compare response even when the tree fallback is inconclusive', async () => {
    const rawData = { status: 'diverged', total_commits: 0, commits: [], files: [] }
    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    mockGetCommitsBetween.mockResolvedValue({
      compareData: {
        compare: {
          status: 'diverged',
          aheadBy: 0,
          behindBy: 0,
          totalCommits: 0,
          changedFiles: 0,
          noDiffDetected: false,
        },
        commits: [],
      },
      rawData,
      apiVersion,
      githubRepoId: 999,
    })
    mockHaveSameCommitTree.mockResolvedValue(null)

    await fetchCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha', 'main', '2026-01-01')

    expect(mockSaveCompareSnapshot).not.toHaveBeenCalled()
    expect(mockSaveCompareRawSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      999,
      'base-sha',
      'head-sha',
      rawData,
      apiVersion,
    )
  })
})

describe('comparison PR refresh failure handling', () => {
  const compareData: CompareData = {
    compare: { status: 'ahead', aheadBy: 1, behindBy: 0, totalCommits: 1, changedFiles: 1, noDiffDetected: false },
    commits: [
      {
        sha: 'b'.repeat(40),
        message: 'Feature',
        authorUsername: 'glad-fjord',
        authorDate: '2026-01-01T00:00:00Z',
        committerDate: '2026-01-01T00:00:00Z',
        parentShas: ['a'.repeat(40)],
        isMergeCommit: false,
        htmlUrl: `https://github.com/navikt/nda/commit/${'b'.repeat(40)}`,
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findPrForCommit).mockResolvedValue({
      prNumber: 123,
      mismatchedBaseBranches: [],
      mismatchedPrNumbers: [],
    })
  })

  it.each([false, true])('keeps strict and default fetch behavior distinct (strict %s)', async (strict) => {
    const error = new Error('Review refresh unavailable')
    vi.mocked(fetchOrRefreshMergedPrData).mockRejectedValue(error)
    const result = buildCommitsBetweenFromCache('navikt', 'nda', 'main', compareData, {
      forceRefresh: true,
      failOnPrRefreshError: strict,
    })
    if (strict) {
      await expect(result).rejects.toBe(error)
    } else {
      expect((await result)[0].pr).toBeNull()
    }
  })

  it('still returns a legitimate missing PR in strict mode when no association exists', async () => {
    vi.mocked(findPrForCommit).mockResolvedValue({
      prNumber: null,
      mismatchedBaseBranches: [],
      mismatchedPrNumbers: [],
    })
    const result = await buildCommitsBetweenFromCache('navikt', 'nda', 'main', compareData, {
      forceRefresh: true,
      failOnPrRefreshError: true,
    })
    expect(result[0].pr).toBeNull()
    expect(fetchOrRefreshMergedPrData).not.toHaveBeenCalled()
  })
})
