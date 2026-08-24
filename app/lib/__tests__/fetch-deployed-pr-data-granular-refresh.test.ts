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
  getMutablePrDataFromGitHub: vi.fn(),
  getPullRequestForCommit: vi.fn(),
}))

import {
  getAllLatestPrRawSnapshots,
  getAllLatestPrSnapshots,
  getLatestCommitSnapshot,
  savePrRawSnapshotsBatch,
} from '~/db/github-data.server'
import { getDetailedPullRequestInfo, getMutablePrDataFromGitHub, getPullRequestForCommit } from '~/lib/github'
import { fetchDeployedPrData } from '~/lib/verification/fetch-data/pr-data.server'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

const mockGetAllLatestPrRawSnapshots = getAllLatestPrRawSnapshots as Mock
const mockGetAllLatestPrSnapshots = getAllLatestPrSnapshots as Mock
const mockGetLatestCommitSnapshot = getLatestCommitSnapshot as Mock
const mockSavePrRawSnapshotsBatch = savePrRawSnapshotsBatch as Mock
const mockGetDetailedPullRequestInfo = getDetailedPullRequestInfo as Mock
const mockGetMutablePrDataFromGitHub = getMutablePrDataFromGitHub as Mock
const mockGetPullRequestForCommit = getPullRequestForCommit as Mock

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

describe('fetchDeployedPrData granular force-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLatestCommitSnapshot.mockResolvedValue({
      data: { prs: [{ number: 100, baseBranch: 'main' }] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })
    mockGetAllLatestPrSnapshots.mockResolvedValue(new Map())
  })

  it('refetches reviews and comments (not pr metadata/commits) when force-refreshing a merged PR', async () => {
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(setUpCachedRawSnapshot(100))
    mockGetPullRequestForCommit.mockResolvedValue({
      pr: { number: 100, title: 'Some PR', html_url: '', merged_at: '2026-01-02T00:00:00Z', state: 'closed' },
      allAssociatedPrs: [{ number: 100, baseBranch: 'main' }],
    })
    mockGetMutablePrDataFromGitHub.mockResolvedValue({
      githubRepoId: 42,
      reviews: [],
      issueComments: [
        {
          id: 5,
          body: 'New comment after merge',
          user: { login: 'dev', avatar_url: '' },
          created_at: '2026-01-03T00:00:00Z',
          html_url: '',
        },
      ],
      reviewComments: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockSavePrRawSnapshotsBatch.mockResolvedValue([1, 2])

    const result = await fetchDeployedPrData('navikt', 'nda', 'abc123', 'main', { forceRefresh: true })

    expect(mockGetMutablePrDataFromGitHub).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(mockGetDetailedPullRequestInfo).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshotsBatch).toHaveBeenCalledWith(
      'navikt',
      'nda',
      100,
      42,
      { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      [
        { dataType: 'reviews', data: [] },
        { dataType: 'comments', data: [expect.objectContaining({ id: 5 })] },
        { dataType: 'review_comments', data: [] },
      ],
    )
    expect(result.deployedPr?.number).toBe(100)
  })

  it('falls back to a full refetch when the current GitHub repo id no longer matches the cached one (repo deleted and recreated)', async () => {
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(setUpCachedRawSnapshot(100, 42))
    mockGetPullRequestForCommit.mockResolvedValue({
      pr: { number: 100, title: 'Some PR', html_url: '', merged_at: '2026-01-02T00:00:00Z', state: 'closed' },
      allAssociatedPrs: [{ number: 100, baseBranch: 'main' }],
    })
    mockGetMutablePrDataFromGitHub.mockResolvedValue({
      githubRepoId: 999,
      reviews: [],
      issueComments: [],
      reviewComments: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockGetDetailedPullRequestInfo.mockResolvedValue({
      prData: {
        title: 'Some PR',
        body: null,
        labels: [],
        created_at: '2026-01-01T00:00:00Z',
        merged_at: '2026-01-02T00:00:00Z',
        base_branch: 'main',
        base_sha: 'base123',
        head_branch: 'feature',
        head_sha: 'head123',
        merge_commit_sha: 'merge123',
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
      githubRepoId: 999,
      apiVersion: { apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockSavePrRawSnapshotsBatch.mockResolvedValue([1, 2, 3, 4, 5])

    const result = await fetchDeployedPrData('navikt', 'nda', 'abc123', 'main', { forceRefresh: true })

    expect(mockGetMutablePrDataFromGitHub).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(mockGetDetailedPullRequestInfo).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(result.deployedPr?.number).toBe(100)
  })

  it('falls back to a full refetch when no raw snapshot exists yet', async () => {
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(new Map())
    mockGetPullRequestForCommit.mockResolvedValue({
      pr: { number: 100, title: 'Some PR', html_url: '', merged_at: null, state: 'open' },
      allAssociatedPrs: [{ number: 100, baseBranch: 'main' }],
    })
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

    const result = await fetchDeployedPrData('navikt', 'nda', 'abc123', 'main', { forceRefresh: true })

    expect(mockGetMutablePrDataFromGitHub).not.toHaveBeenCalled()
    expect(mockGetDetailedPullRequestInfo).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(result.deployedPr?.number).toBe(100)
  })

  it('falls back to a full refetch when the cached PR is not yet merged', async () => {
    const cached = setUpCachedRawSnapshot(100)
    cached.set('pr', { ...cached.get('pr'), data: { ...rawPr, merged_at: null } })
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(cached)

    mockGetPullRequestForCommit.mockResolvedValue({
      pr: { number: 100, title: 'Some PR', html_url: '', merged_at: null, state: 'open' },
      allAssociatedPrs: [{ number: 100, baseBranch: 'main' }],
    })
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

    const result = await fetchDeployedPrData('navikt', 'nda', 'abc123', 'main', { forceRefresh: true })

    expect(mockGetMutablePrDataFromGitHub).not.toHaveBeenCalled()
    expect(mockGetDetailedPullRequestInfo).toHaveBeenCalledWith('navikt', 'nda', 100)
    expect(result.deployedPr?.number).toBe(100)
  })
})
