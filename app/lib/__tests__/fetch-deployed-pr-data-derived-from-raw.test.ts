import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getAllLatestPrRawSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  getLatestCommitAssociatedPrsRawSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getDetailedPullRequestInfo: vi.fn(),
  getDisplayDataFromGitHub: vi.fn(),
  getMutablePrDataFromGitHub: vi.fn(),
  getPullRequestForCommit: vi.fn(),
}))

import { getAllLatestPrRawSnapshots, getLatestCommitSnapshot, savePrRawSnapshotsBatch } from '~/db/github-data.server'
import { getDetailedPullRequestInfo } from '~/lib/github'
import { ensurePrReviewSnapshots, fetchDeployedPrData } from '~/lib/verification/fetch-data/pr-data.server'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

const mockGetAllLatestPrRawSnapshots = getAllLatestPrRawSnapshots as Mock
const mockGetLatestCommitSnapshot = getLatestCommitSnapshot as Mock
const mockGetDetailedPullRequestInfo = getDetailedPullRequestInfo as Mock
const mockSavePrRawSnapshotsBatch = savePrRawSnapshotsBatch as Mock

const rawPr = {
  number: 7,
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

function rawSnapshot(data: unknown) {
  return { githubRepoId: 42, data }
}

describe('fetchDeployedPrData derivedFromRaw signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports derivedFromRaw: true when PR data is derived from a complete raw snapshot without a GitHub call', async () => {
    mockGetLatestCommitSnapshot.mockResolvedValue({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: { prs: [{ number: 7, baseBranch: 'main' }] },
    })

    const map = new Map()
    map.set('pr', rawSnapshot(rawPr))
    map.set(
      'reviews',
      rawSnapshot([{ user: { login: 'r1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2026-01-01T11:00:00Z' }]),
    )
    map.set(
      'commits',
      rawSnapshot([
        {
          sha: 'c1',
          commit: { message: 'feat', author: { date: '2026-01-01T10:00:00Z' } },
          author: { login: 'user1' },
        },
      ]),
    )
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(map)

    const result = await fetchDeployedPrData('navikt', 'nda', 'a'.repeat(40), 'main')

    expect(result.deployedPr).not.toBeNull()
    expect(result.derivedFromRaw).toBe(true)
  })
})

describe('ensurePrReviewSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reuses consistent raw evidence already completed for the delivery', async () => {
    const commits = [
      {
        sha: 'head123',
        commit: { message: 'feature', author: { date: '2026-01-01T10:00:00Z' } },
        author: { login: 'dev' },
      },
    ]
    const snapshots = new Map([
      ['pr', { ...rawSnapshot(rawPr), id: 1 }],
      ['reviews', { ...rawSnapshot([]), id: 2 }],
      ['commits', { ...rawSnapshot(commits), id: 3 }],
      ['comments', { ...rawSnapshot([]), id: 4 }],
      ['review_comments', { ...rawSnapshot([]), id: 5 }],
    ])
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(snapshots)
    const beforeFetch = vi.fn()

    await ensurePrReviewSnapshots(
      'navikt',
      'nda',
      7,
      42,
      {
        pr: 1,
        reviews: 2,
        commits: 3,
        comments: 4,
        reviewComments: 5,
      },
      beforeFetch,
    )

    expect(beforeFetch).not.toHaveBeenCalled()
    expect(mockGetDetailedPullRequestInfo).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshotsBatch).not.toHaveBeenCalled()
  })

  it('refreshes existing PR evidence from GitHub before persisting it', async () => {
    const commits = [
      {
        sha: 'head123',
        commit: { message: 'feature', author: { date: '2026-01-01T10:00:00Z' } },
        author: { login: 'dev' },
      },
    ]
    const reviews = [
      {
        id: 1,
        user: { login: 'reviewer' },
        state: 'APPROVED',
        submitted_at: '2026-01-01T11:00:00Z',
      },
    ]
    const raw = {
      pr: rawPr,
      reviews,
      commits,
      issueComments: [],
      reviewComments: [],
    }
    mockGetDetailedPullRequestInfo.mockResolvedValue({
      prData: {},
      raw,
      githubRepoId: 42,
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(
      new Map([
        ['pr', { ...rawSnapshot(rawPr), id: 1 }],
        ['reviews', { ...rawSnapshot(reviews), id: 2 }],
        ['commits', { ...rawSnapshot(commits), id: 3 }],
        ['comments', { ...rawSnapshot([]), id: 4 }],
        ['review_comments', { ...rawSnapshot([]), id: 5 }],
      ]),
    )

    await ensurePrReviewSnapshots(
      'navikt',
      'nda',
      7,
      42,
      { pr: 10, reviews: 20, commits: 30, comments: 40, reviewComments: 50 },
      vi.fn(),
    )

    expect(mockGetDetailedPullRequestInfo).toHaveBeenCalledWith('navikt', 'nda', 7)
    expect(mockSavePrRawSnapshotsBatch).toHaveBeenCalledWith(
      'navikt',
      'nda',
      7,
      42,
      expect.objectContaining({ apiVersion: '2022-11-28' }),
      expect.arrayContaining([
        { dataType: 'pr', data: rawPr },
        { dataType: 'reviews', data: reviews },
        { dataType: 'commits', data: commits },
      ]),
    )
  })

  it('rejects inconsistent PR metadata and commits without persisting', async () => {
    mockGetDetailedPullRequestInfo.mockResolvedValue({
      prData: {},
      raw: {
        pr: { ...rawPr, commits: 2 },
        reviews: [],
        commits: [
          {
            sha: 'head123',
            commit: { message: 'feature', author: { date: '2026-01-01T10:00:00Z' } },
          },
        ],
        issueComments: [],
        reviewComments: [],
      },
      githubRepoId: 42,
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
    })

    await expect(ensurePrReviewSnapshots('navikt', 'nda', 7, 42, undefined, vi.fn())).rejects.toThrow(
      'Fresh PR #7 snapshots are inconsistent',
    )
    expect(mockSavePrRawSnapshotsBatch).not.toHaveBeenCalled()
  })
})
