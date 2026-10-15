import { pool } from '~/db/connection.server'
import {
  getDerivedCompareDataFromRawSnapshot,
  getLatestCommitAssociatedPrsRawSnapshot,
  getLatestCompareRawSnapshot,
  saveCompareRawSnapshot,
} from '~/db/github-data.server'
import {
  getRepositoryCodeDeliveryAssessmentSyncProgress,
  markRepositoryCodeDeliveryAssessmentAssociationCompleted,
  markRepositoryCodeDeliveryAssessmentPullRequestCompleted,
} from '~/db/repository-code-delivery-assessment-sync.server'
import {
  GITHUB_RATE_LIMIT_SAFETY_BUFFER,
  getCommitsBetween,
  getGitHubRateLimitRemaining,
  getPullRequestForCommit,
} from '~/lib/github'
import { ensurePrReviewSnapshots } from '~/lib/verification/fetch-data/pr-data.server'

interface DeliveryAssessmentContext {
  repositoryId: number
  githubRepoId: number
  githubOwner: string
  githubRepoName: string
  defaultBranch: string | null
  baseSha: string
  headSha: string
}

interface AssociatedPullRequest {
  number: number
  baseBranch: string
}

export class GitHubRateLimitSafetyBufferReachedError extends Error {
  constructor(remaining: number) {
    super(`GitHub rate limit safety buffer reached (${remaining} remaining)`)
    this.name = 'GitHubRateLimitSafetyBufferReachedError'
  }
}

function assertGitHubRateLimitBudget(): void {
  const remaining = getGitHubRateLimitRemaining()
  if (remaining !== null && remaining < GITHUB_RATE_LIMIT_SAFETY_BUFFER) {
    throw new GitHubRateLimitSafetyBufferReachedError(remaining)
  }
}

function parseAssociatedPullRequests(value: unknown): AssociatedPullRequest[] {
  if (!Array.isArray(value)) {
    throw new Error('Commit-associated pull request snapshot is not an array')
  }

  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Commit-associated pull request snapshot contains an invalid entry')
    }
    const pullRequest = item as Record<string, unknown>
    const base = pullRequest.base
    if (
      !Number.isSafeInteger(pullRequest.number) ||
      !base ||
      typeof base !== 'object' ||
      Array.isArray(base) ||
      typeof (base as Record<string, unknown>).ref !== 'string'
    ) {
      throw new Error('Commit-associated pull request snapshot contains incomplete PR data')
    }
    return {
      number: pullRequest.number as number,
      baseBranch: (base as Record<string, string>).ref,
    }
  })
}

async function getDeliveryAssessmentContext(deliveryId: number): Promise<DeliveryAssessmentContext> {
  const { rows } = await pool.query<DeliveryAssessmentContext>(
    `SELECT delivery.repository_id AS "repositoryId",
            repository.github_repo_id AS "githubRepoId",
            repository.github_owner AS "githubOwner",
            repository.github_repo_name AS "githubRepoName",
            repository.default_branch AS "defaultBranch",
            delivery.base_sha AS "baseSha",
            delivery.head_sha AS "headSha"
     FROM repository_code_deliveries delivery
     JOIN repositories repository ON repository.id = delivery.repository_id
     WHERE delivery.id = $1
       AND repository.code_delivery_tracking = true`,
    [deliveryId],
  )
  const context = rows[0]
  if (!context) throw new Error(`Tracked code delivery ${deliveryId} was not found`)
  return { ...context, githubRepoId: Number(context.githubRepoId) }
}

export async function ingestRepositoryDeliveryAssessmentSnapshots(deliveryId: number): Promise<void> {
  const context = await getDeliveryAssessmentContext(deliveryId)
  const { githubOwner, githubRepoName, baseSha, headSha, githubRepoId, defaultBranch } = context
  if (!defaultBranch) throw new Error(`Default branch is unavailable for repository delivery ${deliveryId}`)

  const progress = await getRepositoryCodeDeliveryAssessmentSyncProgress(deliveryId)
  const completedAssociationSnapshotIds = { ...progress.completedAssociationSnapshotIds }
  const completedPullRequestSnapshotIds = { ...progress.completedPullRequestSnapshotIds }
  let compareData = await getDerivedCompareDataFromRawSnapshot(githubOwner, githubRepoName, baseSha, headSha)
  const compareSnapshot = compareData
    ? await getLatestCompareRawSnapshot(githubOwner, githubRepoName, baseSha, headSha)
    : null

  if (!compareData || compareSnapshot?.githubRepoId !== githubRepoId) {
    assertGitHubRateLimitBudget()
    const result = await getCommitsBetween(githubOwner, githubRepoName, baseSha, headSha)
    if (!result) throw new Error(`GitHub compare data is unavailable for delivery ${deliveryId}`)
    if (result.githubRepoId !== githubRepoId) {
      throw new Error(`GitHub repository identity changed while loading delivery ${deliveryId}`)
    }
    await saveCompareRawSnapshot(
      githubOwner,
      githubRepoName,
      githubRepoId,
      baseSha,
      headSha,
      result.rawData,
      result.apiVersion,
    )
    compareData = result.compareData
  }

  const pullRequestsByNumber = new Map<number, AssociatedPullRequest>()
  for (const commit of compareData.commits) {
    let snapshot = await getLatestCommitAssociatedPrsRawSnapshot(githubOwner, githubRepoName, commit.sha)
    const completedSnapshotId = completedAssociationSnapshotIds[commit.sha]
    if (
      completedSnapshotId === undefined ||
      snapshot?.id !== completedSnapshotId ||
      !snapshot?.paginationComplete ||
      snapshot.githubRepoId !== githubRepoId
    ) {
      const previousSnapshotId = snapshot?.id
      assertGitHubRateLimitBudget()
      await getPullRequestForCommit(githubOwner, githubRepoName, commit.sha, false, defaultBranch)
      snapshot = await getLatestCommitAssociatedPrsRawSnapshot(githubOwner, githubRepoName, commit.sha)
      if (previousSnapshotId !== undefined && snapshot && snapshot.id <= previousSnapshotId) {
        throw new Error(`Fresh PR-association snapshot was not persisted for commit ${commit.sha}`)
      }
    }
    if (!snapshot?.paginationComplete) {
      throw new Error(`Complete PR-association snapshot was not persisted for commit ${commit.sha}`)
    }
    if (snapshot.githubRepoId !== githubRepoId) {
      throw new Error(`GitHub repository identity changed while loading commit ${commit.sha}`)
    }
    if (completedAssociationSnapshotIds[commit.sha] !== snapshot.id) {
      await markRepositoryCodeDeliveryAssessmentAssociationCompleted(deliveryId, commit.sha, snapshot.id)
      completedAssociationSnapshotIds[commit.sha] = snapshot.id
    }

    for (const pullRequest of parseAssociatedPullRequests(snapshot.data)) {
      if (pullRequest.baseBranch === defaultBranch) {
        pullRequestsByNumber.set(pullRequest.number, pullRequest)
      }
    }
  }

  for (const pullRequest of pullRequestsByNumber.values()) {
    const previousSnapshotIds = completedPullRequestSnapshotIds[pullRequest.number]
    const snapshotIds = await ensurePrReviewSnapshots(
      githubOwner,
      githubRepoName,
      pullRequest.number,
      githubRepoId,
      previousSnapshotIds,
      assertGitHubRateLimitBudget,
    )
    if (!previousSnapshotIds || !isSamePrSnapshotIds(previousSnapshotIds, snapshotIds)) {
      await markRepositoryCodeDeliveryAssessmentPullRequestCompleted(deliveryId, pullRequest.number, snapshotIds)
      completedPullRequestSnapshotIds[pullRequest.number] = snapshotIds
    }
  }
}

function isSamePrSnapshotIds(
  left: { pr: number; reviews: number; commits: number; comments: number; reviewComments: number },
  right: { pr: number; reviews: number; commits: number; comments: number; reviewComments: number },
): boolean {
  return (
    left.pr === right.pr &&
    left.reviews === right.reviews &&
    left.commits === right.commits &&
    left.comments === right.comments &&
    left.reviewComments === right.reviewComments
  )
}
