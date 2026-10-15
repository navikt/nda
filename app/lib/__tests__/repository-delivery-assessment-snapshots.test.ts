import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const getDerivedCompareDataFromRawSnapshot = vi.fn()
const getLatestCommitAssociatedPrsRawSnapshot = vi.fn()
const getLatestCompareRawSnapshot = vi.fn()
const saveCompareRawSnapshot = vi.fn()
const getCommitsBetween = vi.fn()
const getGitHubRateLimitRemaining = vi.fn()
const getPullRequestForCommit = vi.fn()
const ensurePrReviewSnapshots = vi.fn()
const getRepositoryCodeDeliveryAssessmentSyncProgress = vi.fn()
const markRepositoryCodeDeliveryAssessmentAssociationCompleted = vi.fn()
const markRepositoryCodeDeliveryAssessmentPullRequestCompleted = vi.fn()

vi.mock('~/db/connection.server', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }))
vi.mock('~/db/repository-code-delivery-assessment-sync.server', () => ({
  getRepositoryCodeDeliveryAssessmentSyncProgress: (...args: unknown[]) =>
    getRepositoryCodeDeliveryAssessmentSyncProgress(...args),
  markRepositoryCodeDeliveryAssessmentAssociationCompleted: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentAssociationCompleted(...args),
  markRepositoryCodeDeliveryAssessmentPullRequestCompleted: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentPullRequestCompleted(...args),
}))
vi.mock('~/db/github-data.server', () => ({
  getDerivedCompareDataFromRawSnapshot: (...args: unknown[]) => getDerivedCompareDataFromRawSnapshot(...args),
  getLatestCommitAssociatedPrsRawSnapshot: (...args: unknown[]) => getLatestCommitAssociatedPrsRawSnapshot(...args),
  getLatestCompareRawSnapshot: (...args: unknown[]) => getLatestCompareRawSnapshot(...args),
  saveCompareRawSnapshot: (...args: unknown[]) => saveCompareRawSnapshot(...args),
}))
vi.mock('~/lib/github', () => ({
  GITHUB_RATE_LIMIT_SAFETY_BUFFER: 200,
  getCommitsBetween: (...args: unknown[]) => getCommitsBetween(...args),
  getGitHubRateLimitRemaining: () => getGitHubRateLimitRemaining(),
  getPullRequestForCommit: (...args: unknown[]) => getPullRequestForCommit(...args),
}))
vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({
  ensurePrReviewSnapshots: (...args: unknown[]) => ensurePrReviewSnapshots(...args),
}))

import { ingestRepositoryDeliveryAssessmentSnapshots } from '~/lib/repository-code-delivery/assessment-snapshots.server'

const deliveryContext = {
  repositoryId: 4,
  githubRepoId: 900,
  githubOwner: 'navikt',
  githubRepoName: 'nda',
  defaultBranch: 'main',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
}

const compareData = {
  compare: { status: 'ahead', aheadBy: 2, behindBy: 0, totalCommits: 2, changedFiles: 2, noDiffDetected: false },
  commits: [{ sha: 'c'.repeat(40) }, { sha: 'd'.repeat(40) }],
}

const associatedPullRequests = [{ number: 12, base: { ref: 'main' } }]

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
    })
    ensurePrReviewSnapshots.mockResolvedValue({
      pr: 1,
      reviews: 2,
      commits: 3,
      comments: 4,
      reviewComments: 5,
    })
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
    expect(getPullRequestForCommit).toHaveBeenCalledWith('navikt', 'nda', 'c'.repeat(40), false, 'main')
    expect(ensurePrReviewSnapshots).toHaveBeenCalledTimes(1)
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith('navikt', 'nda', 12, 900, undefined, expect.any(Function))
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

    expect(getPullRequestForCommit).toHaveBeenCalledWith('navikt', 'nda', 'c'.repeat(40), false, 'main')
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith('navikt', 'nda', 12, 900, undefined, expect.any(Function))
  })

  it('refetches a commit association from the current repository generation', async () => {
    getDerivedCompareDataFromRawSnapshot.mockResolvedValue({ ...compareData, commits: [compareData.commits[0]] })
    getLatestCommitAssociatedPrsRawSnapshot
      .mockResolvedValueOnce({ id: 10, githubRepoId: 899, paginationComplete: true, data: associatedPullRequests })
      .mockResolvedValueOnce({ id: 11, githubRepoId: 900, paginationComplete: true, data: associatedPullRequests })

    await ingestRepositoryDeliveryAssessmentSnapshots(7)

    expect(getPullRequestForCommit).toHaveBeenCalledWith('navikt', 'nda', 'c'.repeat(40), false, 'main')
    expect(ensurePrReviewSnapshots).toHaveBeenCalledWith('navikt', 'nda', 12, 900, undefined, expect.any(Function))
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
      'navikt',
      'nda',
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
})
