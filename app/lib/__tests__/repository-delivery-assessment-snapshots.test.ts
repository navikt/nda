import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const getDerivedCompareDataFromRawSnapshot = vi.fn()
const getLatestCommitAssociatedPrsRawSnapshot = vi.fn()
const getLatestCompareRawSnapshot = vi.fn()
const saveCompareRawSnapshot = vi.fn()
const getCommitsBetween = vi.fn()
const getGitHubRateLimitRemaining = vi.fn()
const getCommitAncestryStatus = vi.fn()
const getPullRequestForCommit = vi.fn()
const getPullRequestsForHeadBranch = vi.fn()
const ensurePrReviewSnapshots = vi.fn()
const getAllLatestPrRawSnapshots = vi.fn()
const getRepositoryCodeDeliveryAssessmentSyncProgress = vi.fn()
const markRepositoryCodeDeliveryAssessmentAssociationCompleted = vi.fn()
const markRepositoryCodeDeliveryAssessmentPullRequestCompleted = vi.fn()
const markRepositoryCodeDeliveryAssessmentStackParentsCompleted = vi.fn()

vi.mock('~/db/connection.server', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }))
vi.mock('~/db/repository-code-delivery-assessment-sync.server', () => ({
  getRepositoryCodeDeliveryAssessmentSyncProgress: (...args: unknown[]) =>
    getRepositoryCodeDeliveryAssessmentSyncProgress(...args),
  markRepositoryCodeDeliveryAssessmentAssociationCompleted: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentAssociationCompleted(...args),
  markRepositoryCodeDeliveryAssessmentPullRequestCompleted: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentPullRequestCompleted(...args),
  markRepositoryCodeDeliveryAssessmentStackParentsCompleted: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentStackParentsCompleted(...args),
}))
vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrRawSnapshots: (...args: unknown[]) => getAllLatestPrRawSnapshots(...args),
  getDerivedCompareDataFromRawSnapshot: (...args: unknown[]) => getDerivedCompareDataFromRawSnapshot(...args),
  getLatestCommitAssociatedPrsRawSnapshot: (...args: unknown[]) => getLatestCommitAssociatedPrsRawSnapshot(...args),
  getLatestCompareRawSnapshot: (...args: unknown[]) => getLatestCompareRawSnapshot(...args),
  saveCompareRawSnapshot: (...args: unknown[]) => saveCompareRawSnapshot(...args),
}))
vi.mock('~/lib/github', () => ({
  GITHUB_RATE_LIMIT_SAFETY_BUFFER: 200,
  getCommitAncestryStatus: (...args: unknown[]) => getCommitAncestryStatus(...args),
  getCommitsBetween: (...args: unknown[]) => getCommitsBetween(...args),
  getGitHubRateLimitRemaining: () => getGitHubRateLimitRemaining(),
  getPullRequestsForHeadBranch: (...args: unknown[]) => getPullRequestsForHeadBranch(...args),
  getPullRequestForCommit: (...args: unknown[]) => getPullRequestForCommit(...args),
}))
vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({
  ensurePrReviewSnapshots: (...args: unknown[]) => ensurePrReviewSnapshots(...args),
}))

import { ingestRepositoryDeliveryAssessmentSnapshots } from '~/lib/repository-code-delivery/assessment-snapshots.server'

const deliveryContext = {
  repositoryId: 4,
  githubRepoId: 900,
  githubOwner: 'example-org',
  githubRepoName: 'sample-repo',
  defaultBranch: 'main',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
}

const compareData = {
  compare: { status: 'ahead', aheadBy: 2, behindBy: 0, totalCommits: 2, changedFiles: 2, noDiffDetected: false },
  commits: [{ sha: 'c'.repeat(40) }, { sha: 'd'.repeat(40) }],
}

const associatedPullRequests = [{ number: 12, base: { ref: 'main' } }]
const pullRequestRawSnapshot = {
  number: 12,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  head: { ref: 'feature/change', sha: 'c'.repeat(40) },
  merged_at: null,
  merge_commit_sha: null,
}

describe('ingestRepositoryDeliveryAssessmentSnapshots', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    query.mockResolvedValue({ rows: [deliveryContext] })
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue(compareData)
    getLatestCompareRawSnapshot.mockResolvedValue({ githubRepoId: 900 })
    getLatestCommitAssociatedPrsRawSnapshot.mockResolvedValue({
      id: 11,
      githubRepoId: 900,
      paginationComplete: true,
      data: associatedPullRequests,
    })
    getRepositoryCodeDeliveryAssessmentSyncProgress.mockResolvedValue({
      completedAssociationSnapshotIds: {},
      completedPullRequestSnapshotIds: {},
      stackParentPullRequestNumbers: {},
    })
    ensurePrReviewSnapshots.mockResolvedValue({
      pr: 1,
      reviews: 2,
      commits: 3,
      comments: 4,
      reviewComments: 5,
    })
    getAllLatestPrRawSnapshots.mockResolvedValue(new Map([['pr', { githubRepoId: 900, data: pullRequestRawSnapshot }]]))
    getPullRequestsForHeadBranch.mockResolvedValue([])
    getGitHubRateLimitRemaining.mockReturnValue(null)
  })

  it('refreshes associations per delivery and deduplicates PRs across commits', async () => {
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({ id: 10, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })
      .mockResolvedValueOnce({ id: 11, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })
      .mockResolvedValueOnce({ id: 20, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })
      .mockResolvedValueOnce({ id: 21, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getCommitsBetween).not.toHaveBeenCalled()
    expect(getPullRequestForCommit).toHaveBeenCalledTimes(2)
    expect(getPullRequestForCommit).toHaveBeenCalledWith('example-org', 'sample-repo', 'c'.repeat(40), false, 'main')
    expect(ensurePrReviewSnapshots).toHaveBeenCalledTimes(1)
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      12,
      900,
      undefined,
      expect.any(Function),
    )
    expect(markRepositoryCodeDeliveryAssessmentAssociationCompleted).toHaveBeenCalledTimes(2)
    expect(markRepositoryCodeDeliveryAssessmentPullRequestCompleted).toHaveBeenCalledWith(7, 12, {
      pr: 1,
      reviews: 2,
      commits: 3,
      comments: 4,
      reviewComments: 5,
    })
  })

  it('discovers a PR added after an earlier empty association snapshot', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({ id: 10, githubRepoId: 900, paginationComplete: true, data: [] })
      .mockResolvedValueOnce({ id: 11, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getPullRequestForCommit).toHaveBeenCalledWith('example-org', 'sample-repo', 'c'.repeat(40), false, 'main')
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      12,
      900,
      undefined,
      expect.any(Function),
    )
  })

  it('refetches a commit association from the current repository generation', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({ id: 10, githubRepoId: 899, paginationComplete: true, data: associatedPullRequests })
      .mockResolvedValueOnce({ id: 11, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getPullRequestForCommit).toHaveBeenCalledWith('example-org', 'sample-repo', 'c'.repeat(40), false, 'main')
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      12,
      900,
      undefined,
      expect.any(Function),
    )
  })

  it('checkpoints a persisted association even when the fetch crosses the rate-limit buffer', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({ id: 10, githubRepoId: 900, paginationComplete: true, data: [] })
      .mockResolvedValueOnce({ id: 11, githubRepoId: 900, paginationComplete: true, data: [] })
    getGitHubRateLimitRemaining.mockReturnValue(200)
    getPullRequestForCommit.mockImplementation(async () => {
      getGitHubRateLimitRemaining.mockReturnValue(199)
    })

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(markRepositoryCodeDeliveryAssessmentAssociationCompleted).toHaveBeenCalledWith(7, 'c'.repeat(40), 11)
  })

  it('resumes from completed association and PR evidence after a rate-limit retry', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getRepositoryCodeDeliveryAssessmentSyncProgress.mockResolvedValue({
      completedAssociationSnapshotIds: { ['c'.repeat(40)]: 17 },
      completedPullRequestSnapshotIds: {
        12: { pr: 1, reviews: 2, commits: 3, comments: 4, reviewComments: 5 },
      },
      stackParentPullRequestNumbers: {},
    })
    getLatestCommitAssociatedPrsRawSnapshot.mockResolvedValue({
      id: 17,
      githubRepoId: 900,
      paginationComplete: true,
      data: associatedPullRequests,
    })

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getPullRequestForCommit).not.toHaveBeenCalled()
    expect(markRepositoryCodeDeliveryAssessmentAssociationCompleted).not.toHaveBeenCalled()
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      12,
      900,
      {
        pr: 1,
        reviews: 2,
        commits: 3,
        comments: 4,
        reviewComments: 5,
      },
      expect.any(Function),
    )
    expect(markRepositoryCodeDeliveryAssessmentPullRequestCompleted).not.toHaveBeenCalled()
  })

  it('refreshes commit associations when the associated PR was retargeted', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getRepositoryCodeDeliveryAssessmentSyncProgress.mockResolvedValue({
      completedAssociationSnapshotIds: { ['c'.repeat(40)]: 17 },
      completedPullRequestSnapshotIds: {
        12: { pr: 1, reviews: 2, commits: 3, comments: 4, reviewComments: 5 },
      },
      stackParentPullRequestNumbers: {},
    })
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({
        id: 17,
        githubRepoId: 900,
        paginationComplete: true,
        data: [{ number: 12, base: { ref: 'feature/base' } }],
      })
      .mockResolvedValueOnce({
        id: 18,
        githubRepoId: 900,
        paginationComplete: true,
        data: [{ number: 12, base: { ref: 'main' } }],
      })
    getAllLatestPrRawSnapshots.mockResolvedValue(
      new Map([
        [
          'pr',
          {
            githubRepoId: 900,
            data: {
              ...pullRequestRawSnapshot,
              base: { ref: 'main', sha: 'a'.repeat(40) },
            },
          },
        ],
      ]),
    )

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getPullRequestForCommit).toHaveBeenCalledWith('example-org', 'sample-repo', 'c'.repeat(40), false, 'main')
    expect(markRepositoryCodeDeliveryAssessmentAssociationCompleted).toHaveBeenCalledWith(7, 'c'.repeat(40), 18)
    expect(getPullRequestsForHeadBranch).not.toHaveBeenCalled()
  })

  it('collects anonymized parent PR snapshots for a merged stack chain', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({
        id: 17,
        githubRepoId: 900,
        paginationComplete: true,
        data: [{ number: 13, base: { ref: 'feature/base' } }],
      })
      .mockResolvedValueOnce({
        id: 18,
        githubRepoId: 900,
        paginationComplete: true,
        data: [{ number: 13, base: { ref: 'feature/base' } }],
      })
    getAllLatestPrRawSnapshots.mockImplementation(async (_owner: string, _repo: string, number: number) => {
      const data =
        number === 13
          ? {
              number: 13,
              base: { ref: 'feature/base', sha: 'd'.repeat(40) },
              head: { ref: 'feature/child', sha: 'c'.repeat(40) },
              merged_at: '2026-10-01T13:00:00Z',
              merge_commit_sha: 'e'.repeat(40),
            }
          : {
              number: 12,
              base: { ref: 'main', sha: 'a'.repeat(40) },
              head: { ref: 'feature/base', sha: '9'.repeat(40) },
              merged_at: '2026-10-01T12:00:00Z',
              merge_commit_sha: 'f'.repeat(40),
            }
      return new Map([['pr', { githubRepoId: 900, data }]])
    })
    getPullRequestsForHeadBranch.mockResolvedValue([
      {
        number: 12,
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        headBranch: 'feature/base',
        headSha: '9'.repeat(40),
        mergedAt: '2026-10-01T12:00:00Z',
        mergeCommitSha: 'f'.repeat(40),
      },
    ])
    let ancestrySnapshotArchived = false
    getCommitAncestryStatus.mockImplementation(async () => {
      ancestrySnapshotArchived = true
      return 'ahead'
    })
    getLatestCompareRawSnapshot.mockImplementation(
      async (_owner: string, _repo: string, baseSha: string, headSha: string) =>
        baseSha === 'e'.repeat(40) && headSha === '9'.repeat(40) && ancestrySnapshotArchived
          ? { githubRepoId: 900, data: { status: 'ahead' } }
          : { githubRepoId: 900 },
    )

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getPullRequestsForHeadBranch).toHaveBeenCalledWith('example-org', 'sample-repo', 'feature/base')
    expect(getCommitAncestryStatus).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      'e'.repeat(40),
      '9'.repeat(40),
      900,
    )
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      13,
      900,
      undefined,
      expect.any(Function),
    )
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith(
      'example-org',
      'sample-repo',
      12,
      900,
      undefined,
      expect.any(Function),
    )
    expect(markRepositoryCodeDeliveryAssessmentPullRequestCompleted).toHaveBeenCalledWith(7, 12, {
      pr: 1,
      reviews: 2,
      commits: 3,
      comments: 4,
      reviewComments: 5,
    })
    expect(markRepositoryCodeDeliveryAssessmentStackParentsCompleted).toHaveBeenCalledWith(7, 13, [12])
  })
})
