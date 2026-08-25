import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getAllLatestPrRawSnapshots: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getDetailedPullRequestInfo: vi.fn(),
  getDisplayDataFromGitHub: vi.fn(),
  getMutablePrDataFromGitHub: vi.fn(),
  getPullRequestForCommit: vi.fn(),
}))

import {
  getAllLatestPrRawSnapshots,
  getAllLatestPrSnapshots,
  getLatestCommitSnapshot,
  savePrRawSnapshotsBatch,
} from '~/db/github-data.server'
import { getDetailedPullRequestInfo, getDisplayDataFromGitHub, getMutablePrDataFromGitHub } from '~/lib/github'
import { fetchDeployedPrData } from '~/lib/verification/fetch-data/pr-data.server'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

const mockGetAllLatestPrRawSnapshots = getAllLatestPrRawSnapshots as Mock
const mockGetAllLatestPrSnapshots = getAllLatestPrSnapshots as Mock
const mockGetLatestCommitSnapshot = getLatestCommitSnapshot as Mock
const mockSavePrRawSnapshotsBatch = savePrRawSnapshotsBatch as Mock
const mockGetDetailedPullRequestInfo = getDetailedPullRequestInfo as Mock
const mockGetDisplayDataFromGitHub = getDisplayDataFromGitHub as Mock
const mockGetMutablePrDataFromGitHub = getMutablePrDataFromGitHub as Mock

const rawPr = {
  base: { ref: 'main', sha: 'base123', repo: { id: 42 } },
  head: { ref: 'feature', sha: 'head123' },
  title: 'Some PR',
  body: null,
  labels: [],
  created_at: '2026-01-01T00:00:00Z',
  merged_at: '2026-01-02T00:00:00Z',
  merge_commit_sha: 'merge123',
  commits: 1,
  changed_files: 1,
  additions: 1,
  deletions: 1,
  comments: 0,
  review_comments: 0,
  draft: false,
  mergeable: null,
  mergeable_state: null,
  rebaseable: null,
  locked: false,
  maintainer_can_modify: false,
  auto_merge: null,
  user: { login: 'dev', avatar_url: '' },
  merged_by: null,
  assignees: [],
  requested_reviewers: [],
  requested_teams: [],
  milestone: null,
}

function setUpCachedRawSnapshot(prNumber: number, githubRepoId = 42) {
  const map = new Map()
  map.set('pr', {
    id: 1,
    owner: 'navikt',
    repo: 'nda',
    githubRepoId,
    prNumber,
    dataType: 'pr',
    apiVersion: 'unknown',
    apiDeprecatedAt: null,
    apiSunsetAt: null,
    fetchedAt: new Date(),
    data: rawPr,
  })
  map.set('reviews', { data: [] })
  map.set('commits', { data: [] })
  map.set('comments', { data: [] })
  map.set('review_comments', { data: [] })
  return map
}

describe('fetchDeployedPrData refreshDisplayData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLatestCommitSnapshot.mockResolvedValue({
      data: { prs: [{ number: 100, baseBranch: 'main' }] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })
    mockGetAllLatestPrSnapshots.mockResolvedValue(new Map())
  })

  it('refetches only title/body/labels/comments, not reviews/commits, when refreshDisplayData is set', async () => {
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(setUpCachedRawSnapshot(100))
    mockGetDisplayDataFromGitHub.mockResolvedValue({
      githubRepoId: 42,
      pr: { ...rawPr, title: 'Updated title' },
      issueComments: [
        {
          id: 5,
          body: 'New comment',
          user: { login: 'dev', avatar_url: '' },
          created_at: '2026-01-03T00:00:00Z',
          html_url: '',
        },
      ],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockSavePrRawSnapshotsBatch.mockResolvedValue([1, 2])

    const result = await fetchDeployedPrData('navikt', 'nda', 'abc123', 'main', { refreshDisplayData: true })

    expect(mockGetDisplayDataFromGitHub).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(mockGetMutablePrDataFromGitHub).not.toHaveBeenCalled()
    expect(mockGetDetailedPullRequestInfo).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshotsBatch).toHaveBeenCalledWith(
      'navikt',
      'nda',
      100,
      42,
      { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      [
        { dataType: 'pr', data: expect.objectContaining({ title: 'Updated title' }) },
        { dataType: 'comments', data: [expect.objectContaining({ id: 5 })] },
      ],
    )
    expect(result.deployedPr?.number).toBe(100)
  })

  it('falls back to the derived/cached path when no raw snapshot exists yet', async () => {
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(new Map())
    mockGetDetailedPullRequestInfo.mockResolvedValue({
      prData: {
        title: 'Some PR',
        body: null,
        labels: [],
        created_at: '2026-01-01T00:00:00Z',
        merged_at: null,
        base_branch: 'main',
        base_sha: 'base123',
        head_branch: 'feature',
        head_sha: 'head123',
        merge_commit_sha: null,
        commits_count: 1,
        changed_files: 1,
        additions: 1,
        deletions: 1,
        comments_count: 0,
        review_comments_count: 0,
        draft: false,
        mergeable: null,
        mergeable_state: null,
        rebaseable: null,
        locked: false,
        maintainer_can_modify: false,
        auto_merge: null,
        creator: { username: 'dev', avatar_url: '' },
        merged_by: null,
        merger: null,
        assignees: [],
        requested_reviewers: [],
        requested_teams: [],
        milestone: null,
        checks_passed: null,
        reviewers: [],
        commits: [],
        checks: [],
        comments: [],
      },
      raw: { pr: rawPr, reviews: [], commits: [], issueComments: [], reviewComments: [] },
      githubRepoId: 42,
      apiVersion: { apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockSavePrRawSnapshotsBatch.mockResolvedValue([1, 2, 3, 4, 5])

    const result = await fetchDeployedPrData('navikt', 'nda', 'abc123', 'main', { refreshDisplayData: true })

    expect(mockGetDisplayDataFromGitHub).not.toHaveBeenCalled()
    expect(mockGetDetailedPullRequestInfo).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(result.deployedPr?.number).toBe(100)
  })
})
