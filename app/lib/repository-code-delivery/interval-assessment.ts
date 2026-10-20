import type { ImplicitApprovalMode, PrCommit, PrReview } from '~/lib/verification/types'
import { verifyFourEyesFromPrData } from '~/lib/verification/verify'

export type RepositoryDeliveryCommitAssessmentStatus = 'covered' | 'not_covered' | 'unknown'

export type RepositoryDeliveryCommitAssessmentReason =
  | 'approved_review'
  | 'implicit_approval'
  | 'no_associated_pull_request'
  | 'no_default_branch_pull_request'
  | 'no_approved_reviews'
  | 'no_pull_request_commits'
  | 'approval_before_last_commit'
  | 'self_approval'
  | 'unlinked_commit_author'
  | 'missing_associated_pull_request_snapshot'
  | 'missing_pull_request_snapshot'
  | 'incomplete_pull_request_snapshot'
  | 'pull_request_head_mismatch'
  | 'incomplete_stack_evidence'
  | 'commit_not_in_pull_request'
  | 'unknown_default_branch'
  | 'invalid_comparison_range'

interface RepositoryDeliveryIntervalCommit {
  sha: string
  message: string
  authorUsername: string
  authorLogin: string | null
  htmlUrl: string
  pullRequestNumber: number | null
  status: RepositoryDeliveryCommitAssessmentStatus
  reason: RepositoryDeliveryCommitAssessmentReason
}

export interface RepositoryDeliveryIntervalAssessment {
  state: 'complete' | 'incomplete' | 'unavailable'
  comparisonComplete: boolean
  defaultBranch: string | null
  totalCommits: number | null
  listedCommits: number
  omittedCommits: number
  summary: {
    covered: number
    notCovered: number
    unknown: number
  }
  commits: RepositoryDeliveryIntervalCommit[]
}

export interface RepositoryDeliveryIntervalCompare {
  status: string
  aheadBy: number
  behindBy: number
  totalCommits: number
  commits: Array<{
    sha: string
    message: string
    authorUsername: string
    authorLogin: string | null
    authorDate: string
    committerDate: string
    parentShas: string[]
    isMergeCommit: boolean
    htmlUrl: string
  }>
}

interface RepositoryDeliveryAssociatedPullRequest {
  number: number
  baseBranch: string
}

export interface RepositoryDeliveryAssociatedPullRequestSnapshot {
  complete: boolean
  pullRequests: RepositoryDeliveryAssociatedPullRequest[]
}

export interface RepositoryDeliveryPullRequestEvidence {
  number: number
  baseBranch: string
  baseSha?: string | null
  authorLogin: string | null
  mergedByLogin: string | null
  mergeCommitSha: string | null
  mergedAt?: string | null
  headBranch?: string | null
  headSha: string | null
  commitCount: number | null
  commits: PrCommit[] | null
  reviews: PrReview[] | null
}

export type RepositoryDeliveryStackAncestryStatus = 'identical' | 'ahead' | 'behind' | 'diverged'
type StackPathStatus = 'reaches_default_branch' | 'does_not_reach_default_branch' | 'unknown'

function isMergedPullRequest(pullRequest: RepositoryDeliveryPullRequestEvidence): boolean {
  return pullRequest.mergedAt != null && pullRequest.mergeCommitSha != null
}

function getMergedStackPathStatus(
  pullRequestNumber: number,
  pullRequests: Record<number, RepositoryDeliveryPullRequestEvidence | null | undefined>,
  stackParentPullRequestNumbersByNumber: Record<number, number[]>,
  stackAncestryByPullRequestNumber: Record<number, Record<number, RepositoryDeliveryStackAncestryStatus>>,
  defaultBranch: string,
  visited = new Set<number>(),
): StackPathStatus {
  const pullRequest = pullRequests[pullRequestNumber]
  if (!pullRequest) return 'unknown'
  if (visited.has(pullRequestNumber) || !isMergedPullRequest(pullRequest)) return 'does_not_reach_default_branch'
  if (pullRequest.baseBranch === defaultBranch) return 'reaches_default_branch'

  if (!Object.hasOwn(stackParentPullRequestNumbersByNumber, pullRequestNumber)) return 'unknown'
  const parentPullRequestNumbers = stackParentPullRequestNumbersByNumber[pullRequestNumber]
  if (parentPullRequestNumbers.length === 0) return 'does_not_reach_default_branch'
  visited.add(pullRequestNumber)

  let hasUnknownParent = false
  for (const parentPullRequestNumber of parentPullRequestNumbers) {
    const parent = pullRequests[parentPullRequestNumber]
    if (!parent) {
      hasUnknownParent = true
      continue
    }
    if (!isMergedPullRequest(parent)) continue

    const ancestry = stackAncestryByPullRequestNumber[pullRequestNumber]?.[parentPullRequestNumber]
    if (!ancestry) {
      hasUnknownParent = true
      continue
    }
    if (ancestry !== 'ahead' && ancestry !== 'identical') continue

    const parentPath = getMergedStackPathStatus(
      parentPullRequestNumber,
      pullRequests,
      stackParentPullRequestNumbersByNumber,
      stackAncestryByPullRequestNumber,
      defaultBranch,
      new Set(visited),
    )
    if (parentPath === 'reaches_default_branch') return parentPath
    if (parentPath === 'unknown') hasUnknownParent = true
  }
  return hasUnknownParent ? 'unknown' : 'does_not_reach_default_branch'
}

function unknownCommit(
  commit: RepositoryDeliveryIntervalCompare['commits'][number],
  reason: RepositoryDeliveryCommitAssessmentReason,
  pullRequestNumber: number | null = null,
): RepositoryDeliveryIntervalCommit {
  return {
    sha: commit.sha,
    message: commit.message,
    authorUsername: commit.authorUsername,
    authorLogin: commit.authorLogin,
    htmlUrl: commit.htmlUrl,
    pullRequestNumber,
    status: 'unknown',
    reason,
  }
}

function coveredCommit(
  commit: RepositoryDeliveryIntervalCompare['commits'][number],
  pullRequestNumber: number,
  reason: 'approved_review' | 'implicit_approval',
): RepositoryDeliveryIntervalCommit {
  return {
    sha: commit.sha,
    message: commit.message,
    authorUsername: commit.authorUsername,
    authorLogin: commit.authorLogin,
    htmlUrl: commit.htmlUrl,
    pullRequestNumber,
    status: 'covered',
    reason,
  }
}

function notCoveredCommit(
  commit: RepositoryDeliveryIntervalCompare['commits'][number],
  pullRequestNumber: number | null,
  reason: RepositoryDeliveryCommitAssessmentReason,
): RepositoryDeliveryIntervalCommit {
  return {
    sha: commit.sha,
    message: commit.message,
    authorUsername: commit.authorUsername,
    authorLogin: commit.authorLogin,
    htmlUrl: commit.htmlUrl,
    pullRequestNumber,
    status: 'not_covered',
    reason,
  }
}

function summarize(
  commits: RepositoryDeliveryIntervalCommit[],
  omittedCommits: number,
): RepositoryDeliveryIntervalAssessment['summary'] {
  return {
    covered: commits.filter((commit) => commit.status === 'covered').length,
    notCovered: commits.filter((commit) => commit.status === 'not_covered').length,
    unknown: commits.filter((commit) => commit.status === 'unknown').length + omittedCommits,
  }
}

function assessPullRequestCandidate(
  commit: RepositoryDeliveryIntervalCompare['commits'][number],
  pullRequestNumber: number,
  pullRequest: RepositoryDeliveryPullRequestEvidence | null | undefined,
  expectedBaseBranch: string,
  implicitApprovalMode: ImplicitApprovalMode,
): RepositoryDeliveryIntervalCommit {
  if (!pullRequest) {
    return unknownCommit(commit, 'missing_pull_request_snapshot', pullRequestNumber)
  }

  if (
    pullRequest.baseBranch !== expectedBaseBranch ||
    pullRequest.headSha === null ||
    pullRequest.commitCount === null ||
    pullRequest.commits === null ||
    pullRequest.reviews === null ||
    pullRequest.commitCount !== pullRequest.commits.length
  ) {
    return unknownCommit(commit, 'incomplete_pull_request_snapshot', pullRequestNumber)
  }
  if (pullRequest.commits[pullRequest.commits.length - 1]?.sha !== pullRequest.headSha) {
    return unknownCommit(commit, 'pull_request_head_mismatch', pullRequestNumber)
  }

  const commitIsInPullRequest =
    pullRequest.commits.some((prCommit) => prCommit.sha === commit.sha) || pullRequest.mergeCommitSha === commit.sha
  if (!commitIsInPullRequest) {
    return unknownCommit(commit, 'commit_not_in_pull_request', pullRequestNumber)
  }

  const result = verifyFourEyesFromPrData({
    reviewers: pullRequest.reviews,
    commits: pullRequest.commits,
    baseBranch: pullRequest.baseBranch,
    mergedBy: pullRequest.mergedByLogin,
    prCreator: pullRequest.authorLogin ?? undefined,
    implicitApprovalMode,
  })
  if (result.hasFourEyes) {
    return coveredCommit(
      commit,
      pullRequestNumber,
      result.method === 'implicit' ? 'implicit_approval' : 'approved_review',
    )
  }

  const reason: RepositoryDeliveryCommitAssessmentReason =
    result.reason === 'No commits found in PR'
      ? 'no_pull_request_commits'
      : result.reason === 'no_approved_reviews'
        ? 'no_approved_reviews'
        : result.reason === 'approval_before_last_commit'
          ? 'approval_before_last_commit'
          : result.reason === 'self_approval'
            ? 'self_approval'
            : result.reason === 'unlinked_commit_author'
              ? 'unlinked_commit_author'
              : 'incomplete_pull_request_snapshot'
  return notCoveredCommit(commit, pullRequestNumber, reason)
}

export function assessRepositoryDeliveryInterval(input: {
  compare: RepositoryDeliveryIntervalCompare | null
  defaultBranch: string | null
  implicitApprovalMode: ImplicitApprovalMode
  associatedPullRequestsByCommit: Record<string, RepositoryDeliveryAssociatedPullRequestSnapshot | undefined>
  pullRequestsByNumber: Record<number, RepositoryDeliveryPullRequestEvidence | null | undefined>
  stackParentPullRequestNumbersByNumber?: Record<number, number[]>
  stackAncestryByPullRequestNumber?: Record<number, Record<number, RepositoryDeliveryStackAncestryStatus>>
}): RepositoryDeliveryIntervalAssessment {
  const { compare, defaultBranch, implicitApprovalMode } = input
  const stackParentPullRequestNumbersByNumber = input.stackParentPullRequestNumbersByNumber ?? {}
  const stackAncestryByPullRequestNumber = input.stackAncestryByPullRequestNumber ?? {}
  if (!compare) {
    return {
      state: 'unavailable',
      comparisonComplete: false,
      defaultBranch,
      totalCommits: null,
      listedCommits: 0,
      omittedCommits: 0,
      summary: { covered: 0, notCovered: 0, unknown: 0 },
      commits: [],
    }
  }

  const omittedCommits = Math.max(0, compare.totalCommits - compare.commits.length)
  const comparisonCommitCountMatches = compare.totalCommits === compare.commits.length
  const validComparison =
    (compare.status === 'ahead' &&
      compare.behindBy === 0 &&
      compare.aheadBy === compare.totalCommits &&
      compare.commits.length <= compare.totalCommits) ||
    (compare.status === 'identical' && compare.aheadBy === 0 && compare.behindBy === 0 && compare.totalCommits === 0)
  const completeComparison = validComparison && comparisonCommitCountMatches
  const commits = compare.commits.map((commit) => {
    if (!validComparison) return unknownCommit(commit, 'invalid_comparison_range')
    if (!defaultBranch) return unknownCommit(commit, 'unknown_default_branch')

    const associations = input.associatedPullRequestsByCommit[commit.sha]
    if (!associations?.complete) {
      return unknownCommit(commit, 'missing_associated_pull_request_snapshot')
    }

    const matchingPullRequests: Array<{ number: number; baseBranch: string }> = []
    const unresolvedStackPullRequests: number[] = []
    for (const pr of associations.pullRequests) {
      if (pr.baseBranch === defaultBranch) {
        matchingPullRequests.push(pr)
        continue
      }
      const pullRequest = input.pullRequestsByNumber[pr.number]
      const stackPath = getMergedStackPathStatus(
        pr.number,
        input.pullRequestsByNumber,
        stackParentPullRequestNumbersByNumber,
        stackAncestryByPullRequestNumber,
        defaultBranch,
      )
      if (pullRequest?.baseBranch !== pr.baseBranch || stackPath === 'unknown') {
        unresolvedStackPullRequests.push(pr.number)
      } else if (stackPath === 'reaches_default_branch') {
        matchingPullRequests.push(pr)
      }
    }
    if (matchingPullRequests.length === 0) {
      if (unresolvedStackPullRequests.length > 0) {
        return unknownCommit(commit, 'incomplete_stack_evidence', unresolvedStackPullRequests[0])
      }
      return associations.pullRequests.length === 0
        ? notCoveredCommit(commit, null, 'no_associated_pull_request')
        : notCoveredCommit(commit, null, 'no_default_branch_pull_request')
    }

    const candidates = matchingPullRequests.map((pullRequest) =>
      assessPullRequestCandidate(
        commit,
        pullRequest.number,
        input.pullRequestsByNumber[pullRequest.number],
        pullRequest.baseBranch,
        implicitApprovalMode,
      ),
    )
    candidates.push(
      ...unresolvedStackPullRequests.map((pullRequestNumber) =>
        unknownCommit(commit, 'incomplete_stack_evidence', pullRequestNumber),
      ),
    )
    const covered = candidates.find((candidate) => candidate.status === 'covered')
    if (covered) return covered
    const unknown = candidates.find((candidate) => candidate.status === 'unknown')
    if (unknown) return unknown
    return candidates[0]
  })

  const state = !completeComparison || commits.some((commit) => commit.status === 'unknown') ? 'incomplete' : 'complete'

  return {
    state,
    comparisonComplete: completeComparison,
    defaultBranch,
    totalCommits: compare.totalCommits,
    listedCommits: compare.commits.length,
    omittedCommits,
    summary: summarize(commits, omittedCommits),
    commits,
  }
}
