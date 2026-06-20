import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getLatestCommitSnapshot: vi.fn(),
  getAllLatestPrSnapshots: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  savePrSnapshotsBatch: vi.fn(),
  getLatestCompareSnapshot: vi.fn(),
  saveCompareSnapshot: vi.fn(),
  markPrDataUnavailable: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: vi.fn(),
}))

vi.mock('~/db/sync-jobs.server', () => ({
  heartbeatSyncJob: vi.fn(),
  isSyncJobCancelled: vi.fn(),
  logSyncJobMessage: vi.fn(),
  updateSyncJobProgress: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getPullRequestForCommit: vi.fn(),
  getDetailedPullRequestInfo: vi.fn(),
  getCommitsBetween: vi.fn(),
  haveSameCommitTree: vi.fn(),
  isCommitOnBranch: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getAllLatestPrSnapshots, getLatestCommitSnapshot, saveCommitSnapshot } from '~/db/github-data.server'
import { getDetailedPullRequestInfo, getPullRequestForCommit } from '~/lib/github'
import { buildCommitsBetweenFromCache } from '~/lib/verification/fetch-data.server'
import type { CompareData } from '~/lib/verification/types'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

const mockGetCommitSnapshot = getLatestCommitSnapshot as Mock
const mockGetPrForCommit = getPullRequestForCommit as Mock
const mockSaveCommitSnapshot = saveCommitSnapshot as Mock
const mockGetAllPrSnapshots = getAllLatestPrSnapshots as Mock
const mockGetDetailedPrInfo = getDetailedPullRequestInfo as Mock

function makeCompareData(
  commits: CompareData['commits'],
  compareOverrides: Partial<CompareData['compare']> = {},
): CompareData {
  return {
    compare: {
      status: commits.length > 0 ? 'ahead' : 'identical',
      aheadBy: commits.length,
      behindBy: 0,
      totalCommits: commits.length,
      changedFiles: commits.length,
      noDiffDetected: false,
      ...compareOverrides,
    },
    commits,
  }
}

describe('findPrForCommit stale cache handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveCommitSnapshot.mockResolvedValue(undefined)
  })

  it('trusts empty cache without calling GitHub (no staleness-based re-fetch)', async () => {
    mockGetCommitSnapshot.mockResolvedValue({
      data: { prs: [] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })

    const compareData = makeCompareData([
      {
        sha: 'abc123',
        message: 'Direct push without PR',
        authorUsername: 'user1',
        authorDate: '2026-04-27T16:00:00Z',
        committerDate: '2026-04-27T16:00:00Z',
        parentShas: ['parent1'],
        isMergeCommit: false,
        htmlUrl: 'https://github.com/navikt/repo/commit/abc123',
      },
    ])

    const result = await buildCommitsBetweenFromCache('navikt', 'repo', 'main', compareData)

    expect(mockGetPrForCommit).not.toHaveBeenCalled()
    expect(result[0].pr).toBeNull()
  })

  it('bypasses stale empty cache when forceRefresh is true', async () => {
    mockGetCommitSnapshot.mockResolvedValue({
      data: { prs: [] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })

    mockGetPrForCommit.mockResolvedValue({
      pr: {
        number: 100,
        title: 'Feature branch',
        html_url: 'https://github.com/navikt/repo/pull/100',
        merged_at: '2026-04-27T16:00:00Z',
        state: 'closed',
      },
      allAssociatedPrs: [{ number: 100, baseBranch: 'main' }],
    })

    mockGetDetailedPrInfo.mockResolvedValue({
      number: 100,
      title: 'Feature branch',
      body: null,
      draft: false,
      created_at: '2026-04-27T10:00:00Z',
      merged_at: '2026-04-27T16:00:00Z',
      merge_commit_sha: 'abc123',
      base_branch: 'main',
      base_sha: 'base123',
      head_branch: 'feature-branch',
      head_sha: 'head123',
      creator: { username: 'user1', avatar_url: '' },
      merger: { username: 'user1', avatar_url: '' },
      merged_by: { username: 'user1', avatar_url: '' },
      labels: [],
      commits_count: 1,
      changed_files: 1,
      additions: 10,
      deletions: 5,
      comments_count: 0,
      review_comments_count: 0,
      locked: false,
      mergeable: true,
      mergeable_state: 'clean',
      rebaseable: true,
      maintainer_can_modify: false,
      auto_merge: null,
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      milestone: null,
      checks_passed: true,
      reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-04-27T14:00:00Z' }],
      commits: [
        { sha: 'commit1', message: 'feat: add feature', author: { username: 'user1' }, date: '2026-04-27T12:00:00Z' },
      ],
      checks: [],
      comments: [],
    })

    mockGetAllPrSnapshots.mockResolvedValue(new Map())

    const compareData = makeCompareData([
      {
        sha: 'abc123',
        message: 'Merge pull request #100 from navikt/feature-branch',
        authorUsername: 'user1',
        authorDate: '2026-04-27T16:00:00Z',
        committerDate: '2026-04-27T16:00:00Z',
        parentShas: ['parent1', 'parent2'],
        isMergeCommit: true,
        htmlUrl: 'https://github.com/navikt/repo/commit/abc123',
      },
    ])

    const result = await buildCommitsBetweenFromCache('navikt', 'repo', 'main', compareData, {
      forceRefresh: true,
    })

    expect(mockGetPrForCommit).toHaveBeenCalledWith('navikt', 'repo', 'abc123', true, 'main')
    expect(mockSaveCommitSnapshot).toHaveBeenCalledWith('navikt', 'repo', 'abc123', 'prs', {
      prs: [{ number: 100, baseBranch: 'main' }],
    })
    expect(mockGetDetailedPrInfo).toHaveBeenCalledWith('navikt', 'repo', 100)
    expect(result[0].pr).not.toBeNull()
    expect(result[0].pr?.number).toBe(100)
  })

  it('respects cacheOnly even when cache is empty', async () => {
    mockGetCommitSnapshot.mockResolvedValue({
      data: { prs: [] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })

    const compareData = makeCompareData([
      {
        sha: 'abc123',
        message: 'Some commit',
        authorUsername: 'user1',
        authorDate: '2026-04-27T16:00:00Z',
        committerDate: '2026-04-27T16:00:00Z',
        parentShas: ['parent1'],
        isMergeCommit: false,
        htmlUrl: 'https://github.com/navikt/repo/commit/abc123',
      },
    ])

    const result = await buildCommitsBetweenFromCache('navikt', 'repo', 'main', compareData, {
      cacheOnly: true,
    })

    expect(mockGetPrForCommit).not.toHaveBeenCalled()
    expect(result[0].pr).toBeNull()
  })
})
