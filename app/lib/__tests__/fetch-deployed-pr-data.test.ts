import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  savePrSnapshotsBatch: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getDetailedPullRequestInfo: vi.fn(),
  getPullRequestForCommit: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getAllLatestPrSnapshots, getLatestCommitSnapshot, savePrSnapshotsBatch } from '~/db/github-data.server'
import { getDetailedPullRequestInfo } from '~/lib/github'
import { fetchDeployedPrData } from '~/lib/verification/fetch-data/pr-data.server'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

const mockGetAllLatestPrSnapshots = getAllLatestPrSnapshots as ReturnType<typeof vi.fn>
const mockGetLatestCommitSnapshot = getLatestCommitSnapshot as ReturnType<typeof vi.fn>
const mockSavePrSnapshotsBatch = savePrSnapshotsBatch as ReturnType<typeof vi.fn>
const mockGetDetailedPrInfo = getDetailedPullRequestInfo as ReturnType<typeof vi.fn>

const rawPrInfo = {
  title: 'Fix calculation',
  body: 'Fixes the bug',
  labels: [],
  created_at: '2026-02-20T10:00:00Z',
  merged_at: '2026-02-25T14:30:00Z',
  base_branch: 'main',
  base_sha: 'abc123',
  head_branch: 'feature/x',
  head_sha: 'def456',
  merge_commit_sha: 'merge789',
  commits_count: 1,
  changed_files: 5,
  additions: 120,
  deletions: 40,
  comments_count: 0,
  review_comments_count: 0,
  draft: false,
  mergeable: true,
  mergeable_state: 'clean',
  rebaseable: true,
  locked: false,
  maintainer_can_modify: true,
  auto_merge: null,
  creator: { username: 'developer-a', avatar_url: 'https://avatar/a' },
  merged_by: null,
  merger: null,
  assignees: [],
  requested_reviewers: [],
  requested_teams: [],
  milestone: null,
  reviewers: [],
  checks_passed: true,
  checks: [],
  commits: [],
  comments: [],
}

describe('fetchDeployedPrData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cached snapshots without calling GitHub when all data types are present', async () => {
    mockGetLatestCommitSnapshot.mockResolvedValue({
      data: { prs: [{ number: 42, baseBranch: 'main' }] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })
    mockGetAllLatestPrSnapshots.mockResolvedValue(
      new Map([
        ['metadata', { data: { title: 'cached' } }],
        ['reviews', { data: [] }],
        ['commits', { data: [] }],
        ['checks', { data: {} }],
        ['comments', { data: [] }],
      ]),
    )

    const result = await fetchDeployedPrData('navikt', 'nda', 'sha1', 'main')

    expect(mockGetDetailedPrInfo).not.toHaveBeenCalled()
    expect(mockSavePrSnapshotsBatch).not.toHaveBeenCalled()
    expect(result).toEqual({
      deployedPr: {
        number: 42,
        url: 'https://github.com/navikt/nda/pull/42',
        metadata: { title: 'cached' },
        reviews: [],
        commits: [],
      },
      mismatchedBaseBranches: [],
      mismatchedPrNumbers: [],
    })
  })

  it('fetches from GitHub and persists exactly one snapshot per data type on a cache miss', async () => {
    mockGetLatestCommitSnapshot.mockResolvedValue({
      data: { prs: [{ number: 42, baseBranch: 'main' }] },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    })
    mockGetAllLatestPrSnapshots.mockResolvedValue(new Map())
    mockGetDetailedPrInfo.mockResolvedValue(rawPrInfo)

    const result = await fetchDeployedPrData('navikt', 'nda', 'sha1', 'main')

    expect(mockSavePrSnapshotsBatch).toHaveBeenCalledTimes(1)
    const [owner, repo, prNumber, snapshots] = mockSavePrSnapshotsBatch.mock.calls[0]
    expect(owner).toBe('navikt')
    expect(repo).toBe('nda')
    expect(prNumber).toBe(42)
    expect(snapshots.map((s: { dataType: string }) => s.dataType).sort()).toEqual(
      ['checks', 'comments', 'commits', 'metadata', 'reviews'].sort(),
    )
    expect(result.deployedPr).toMatchObject({
      number: 42,
      url: 'https://github.com/navikt/nda/pull/42',
    })
  })
})
