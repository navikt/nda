import { pool } from '~/db/connection.server'
import {
  getAllLatestPrRawSnapshots,
  getDerivedCompareDataFromRawSnapshot,
  getLatestCommitAssociatedPrsRawSnapshot,
  getLatestCompareRawSnapshot,
  saveCompareRawSnapshot,
} from '~/db/github-data.server'
import {
  getRepositoryCodeDeliveryAssessmentSyncProgress,
  markRepositoryCodeDeliveryAssessmentAssociationCompleted,
  markRepositoryCodeDeliveryAssessmentPullRequestCompleted,
  markRepositoryCodeDeliveryAssessmentStackParentsCompleted,
} from '~/db/repository-code-delivery-assessment-sync.server'
import {
  GITHUB_RATE_LIMIT_SAFETY_BUFFER,
  getCommitAncestryStatus,
  getCommitsBetween,
  getGitHubRateLimitRemaining,
  getPullRequestForCommit,
  getPullRequestsForHeadBranch,
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

interface PullRequestBranchEvidence extends AssociatedPullRequest {
  baseSha: string
  headBranch: string
  headSha: string
  mergedAt: string | null
  mergeCommitSha: string | null
}

type CommitAncestryStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

function isCommitAncestryStatus(value: unknown): value is CommitAncestryStatus {
  return value === 'identical' || value === 'ahead' || value === 'behind' || value === 'diverged'
}

function parsePullRequestBranchEvidence(
  value: unknown,
  pullRequestNumber: number,
  githubRepoId: number,
  snapshotGithubRepoId: number | undefined,
): PullRequestBranchEvidence {
  if (snapshotGithubRepoId !== githubRepoId || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`PR #${pullRequestNumber} snapshot is unavailable for the current repository`)
  }
  const pullRequest = value as Record<string, unknown>
  const base = pullRequest.base
  const head = pullRequest.head
  if (
    pullRequest.number !== pullRequestNumber ||
    !base ||
    typeof base !== 'object' ||
    Array.isArray(base) ||
    !head ||
    typeof head !== 'object' ||
    Array.isArray(head)
  ) {
    throw new Error(`PR #${pullRequestNumber} snapshot has incomplete branch data`)
  }
  const baseData = base as Record<string, unknown>
  const headData = head as Record<string, unknown>
  if (
    typeof baseData.ref !== 'string' ||
    typeof baseData.sha !== 'string' ||
    typeof headData.ref !== 'string' ||
    typeof headData.sha !== 'string' ||
    (pullRequest.merged_at !== null && typeof pullRequest.merged_at !== 'string') ||
    (pullRequest.merge_commit_sha !== null && typeof pullRequest.merge_commit_sha !== 'string')
  ) {
    throw new Error(`PR #${pullRequestNumber} snapshot has invalid branch data`)
  }
  return {
    number: pullRequestNumber,
    baseBranch: baseData.ref,
    baseSha: baseData.sha,
    headBranch: headData.ref,
    headSha: headData.sha,
    mergedAt: pullRequest.merged_at,
    mergeCommitSha: pullRequest.merge_commit_sha,
  }
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
  const stackParentPullRequestNumbers = { ...progress.stackParentPullRequestNumbers }
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
  const associatedPullRequestsByCommit = new Map<string, AssociatedPullRequest[]>()
  const associationSnapshotIdsByCommit = new Map<string, number>()
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

    const associatedPullRequests = parseAssociatedPullRequests(snapshot.data)
    associatedPullRequestsByCommit.set(commit.sha, associatedPullRequests)
    associationSnapshotIdsByCommit.set(commit.sha, snapshot.id)
    for (const pullRequest of associatedPullRequests) {
      pullRequestsByNumber.set(pullRequest.number, pullRequest)
    }
  }

  const storedPullRequests = new Map<number, PullRequestBranchEvidence>()
  const ensurePullRequest = async (pullRequestNumber: number): Promise<PullRequestBranchEvidence> => {
    const existing = storedPullRequests.get(pullRequestNumber)
    if (existing) return existing
    const previousSnapshotIds = completedPullRequestSnapshotIds[pullRequestNumber]
    const snapshotIds = await ensurePrReviewSnapshots(
      githubOwner,
      githubRepoName,
      pullRequestNumber,
      githubRepoId,
      previousSnapshotIds,
      assertGitHubRateLimitBudget,
    )
    if (!previousSnapshotIds || !isSamePrSnapshotIds(previousSnapshotIds, snapshotIds)) {
      await markRepositoryCodeDeliveryAssessmentPullRequestCompleted(deliveryId, pullRequestNumber, snapshotIds)
      completedPullRequestSnapshotIds[pullRequestNumber] = snapshotIds
    }
    const snapshots = await getAllLatestPrRawSnapshots(githubOwner, githubRepoName, pullRequestNumber)
    const prSnapshot = snapshots.get('pr')
    const evidence = parsePullRequestBranchEvidence(
      prSnapshot?.data,
      pullRequestNumber,
      githubRepoId,
      prSnapshot?.githubRepoId,
    )
    storedPullRequests.set(pullRequestNumber, evidence)
    return evidence
  }

  const refreshCommitAssociations = async (commitSha: string): Promise<AssociatedPullRequest[]> => {
    const previousSnapshotId = associationSnapshotIdsByCommit.get(commitSha)
    assertGitHubRateLimitBudget()
    await getPullRequestForCommit(githubOwner, githubRepoName, commitSha, false, defaultBranch)
    const refreshedSnapshot = await getLatestCommitAssociatedPrsRawSnapshot(githubOwner, githubRepoName, commitSha)
    if (
      !refreshedSnapshot?.paginationComplete ||
      refreshedSnapshot.githubRepoId !== githubRepoId ||
      (previousSnapshotId !== undefined && refreshedSnapshot.id <= previousSnapshotId)
    ) {
      throw new Error(`Fresh PR-association snapshot was not persisted for commit ${commitSha}`)
    }

    const refreshedAssociations = parseAssociatedPullRequests(refreshedSnapshot.data)
    associatedPullRequestsByCommit.set(commitSha, refreshedAssociations)
    associationSnapshotIdsByCommit.set(commitSha, refreshedSnapshot.id)
    await markRepositoryCodeDeliveryAssessmentAssociationCompleted(deliveryId, commitSha, refreshedSnapshot.id)
    return refreshedAssociations
  }

  for (const pullRequest of pullRequestsByNumber.values()) {
    await ensurePullRequest(pullRequest.number)
  }

  for (const commit of compareData.commits) {
    const currentAssociations = associatedPullRequestsByCommit.get(commit.sha) ?? []
    const hasRetargetedPullRequest = currentAssociations.some(
      (pullRequest) => storedPullRequests.get(pullRequest.number)?.baseBranch !== pullRequest.baseBranch,
    )
    if (!hasRetargetedPullRequest) continue

    const refreshedAssociations = await refreshCommitAssociations(commit.sha)
    for (const pullRequest of refreshedAssociations) {
      pullRequestsByNumber.set(pullRequest.number, pullRequest)
      let evidence = await ensurePullRequest(pullRequest.number)
      if (evidence.baseBranch !== pullRequest.baseBranch) {
        storedPullRequests.delete(pullRequest.number)
        delete completedPullRequestSnapshotIds[pullRequest.number]
        evidence = await ensurePullRequest(pullRequest.number)
      }
      if (evidence.baseBranch !== pullRequest.baseBranch) {
        throw new Error(`PR association base branch is stale for commit ${commit.sha}`)
      }
    }
  }

  for (const commit of compareData.commits) {
    const currentAssociations = associatedPullRequestsByCommit.get(commit.sha) ?? []
    const hasStaleAssociation = currentAssociations.some(
      (pullRequest) => storedPullRequests.get(pullRequest.number)?.baseBranch !== pullRequest.baseBranch,
    )
    if (!hasStaleAssociation) continue

    const refreshedAssociations = await refreshCommitAssociations(commit.sha)
    for (const pullRequest of refreshedAssociations) {
      pullRequestsByNumber.set(pullRequest.number, pullRequest)
      let evidence = await ensurePullRequest(pullRequest.number)
      if (evidence.baseBranch !== pullRequest.baseBranch) {
        storedPullRequests.delete(pullRequest.number)
        delete completedPullRequestSnapshotIds[pullRequest.number]
        evidence = await ensurePullRequest(pullRequest.number)
      }
      if (evidence.baseBranch !== pullRequest.baseBranch) {
        throw new Error(`PR association base branch is stale for commit ${commit.sha}`)
      }
    }
  }

  for (const [commitSha, associations] of associatedPullRequestsByCommit) {
    if (
      associations.some(
        (pullRequest) => storedPullRequests.get(pullRequest.number)?.baseBranch !== pullRequest.baseBranch,
      )
    ) {
      throw new Error(`PR association base branch is stale for commit ${commitSha}`)
    }
  }

  pullRequestsByNumber.clear()
  for (const associatedPullRequests of associatedPullRequestsByCommit.values()) {
    for (const pullRequest of associatedPullRequests) {
      pullRequestsByNumber.set(pullRequest.number, pullRequest)
    }
  }

  const pendingPullRequests: number[] = []
  for (const pullRequest of pullRequestsByNumber.values()) {
    pendingPullRequests.push(pullRequest.number)
  }

  const visitedPullRequests = new Set<number>()
  while (pendingPullRequests.length > 0) {
    const pullRequestNumber = pendingPullRequests.shift()
    if (pullRequestNumber === undefined || visitedPullRequests.has(pullRequestNumber)) continue
    visitedPullRequests.add(pullRequestNumber)
    const pullRequest = storedPullRequests.get(pullRequestNumber)
    if (
      !pullRequest ||
      pullRequest.baseBranch === defaultBranch ||
      !pullRequest.mergedAt ||
      !pullRequest.mergeCommitSha
    ) {
      continue
    }
    assertGitHubRateLimitBudget()
    let parentPullRequestNumbers = stackParentPullRequestNumbers[pullRequestNumber]
    if (!parentPullRequestNumbers) {
      const possibleParents = await getPullRequestsForHeadBranch(githubOwner, githubRepoName, pullRequest.baseBranch)
      parentPullRequestNumbers = possibleParents
        .filter((parent) => parent.headBranch === pullRequest.baseBranch && parent.number !== pullRequestNumber)
        .map((parent) => parent.number)
      await markRepositoryCodeDeliveryAssessmentStackParentsCompleted(
        deliveryId,
        pullRequestNumber,
        parentPullRequestNumbers,
      )
      stackParentPullRequestNumbers[pullRequestNumber] = parentPullRequestNumbers
    }

    for (const parentPullRequestNumber of parentPullRequestNumbers) {
      const parent = await ensurePullRequest(parentPullRequestNumber)
      if (!parent.mergedAt || !parent.mergeCommitSha || !parent.headSha) continue
      const ancestry = await getStoredCommitAncestryStatus(
        githubOwner,
        githubRepoName,
        githubRepoId,
        pullRequest.mergeCommitSha,
        parent.headSha,
        assertGitHubRateLimitBudget,
      )
      if (ancestry === 'ahead' || ancestry === 'identical') {
        pendingPullRequests.push(parent.number)
      }
    }
  }
}

async function getStoredCommitAncestryStatus(
  owner: string,
  repo: string,
  githubRepoId: number,
  childMergeCommitSha: string,
  parentMergeCommitSha: string,
  beforeFetch: () => void,
): Promise<CommitAncestryStatus> {
  const readStatus = async (): Promise<CommitAncestryStatus | null> => {
    const snapshot = await getLatestCompareRawSnapshot(owner, repo, childMergeCommitSha, parentMergeCommitSha)
    if (snapshot?.githubRepoId !== githubRepoId || !snapshot.data || typeof snapshot.data !== 'object') return null
    const status = (snapshot.data as Record<string, unknown>).status
    return isCommitAncestryStatus(status) ? status : null
  }
  const currentStatus = await readStatus()
  if (currentStatus) return currentStatus

  beforeFetch()
  const fetchedStatus = await getCommitAncestryStatus(
    owner,
    repo,
    childMergeCommitSha,
    parentMergeCommitSha,
    githubRepoId,
  )
  if (!isCommitAncestryStatus(fetchedStatus)) {
    throw new Error(`Failed to compare stacked PR merge commits in ${owner}/${repo}`)
  }
  const storedStatus = await readStatus()
  if (storedStatus !== fetchedStatus) {
    throw new Error(`Stacked PR merge ancestry was not archived for ${owner}/${repo}`)
  }
  return storedStatus
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
