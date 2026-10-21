import { isFullCommitSha } from '~/lib/git-constants'
import type { RepositoryDeliveryIntervalAssessment } from './interval-assessment'

export function assessStoredRepositoryDeliveryApproval(
  delivery: { base_sha: string; head_sha: string },
  interval: RepositoryDeliveryIntervalAssessment,
  history: Array<{
    sha: string
    status: string
    author_login: string | null
    author_nav_ident: string | null
    reviewer_nav_ident: string
  }>,
  authorIdentities: Map<string, string | null>,
): RepositoryDeliveryApprovalAssessment {
  const anchor = delivery.base_sha.toLowerCase() === delivery.head_sha.toLowerCase()
  const commits = anchor ? [] : interval.commits
  const commitsBySha = new Map(commits.map((commit) => [commit.sha.toLowerCase(), commit]))
  return assessRepositoryDeliveryApproval({
    baseSha: delivery.base_sha,
    headSha: delivery.head_sha,
    commitHistoryComplete: anchor || interval.comparisonComplete,
    totalCommits: anchor ? 0 : interval.totalCommits,
    commits: commits.map((commit) => ({
      sha: commit.sha,
      authorIdentityKey: commit.authorLogin ? (authorIdentities.get(commit.authorLogin) ?? null) : null,
      prCoverage:
        commit.status === 'covered' ? 'approved' : commit.status === 'not_covered' ? 'not_approved' : 'unknown',
    })),
    approvals: history
      .filter((approval) => {
        const author = commitsBySha.get(approval.sha.toLowerCase())?.authorLogin
        return (
          author &&
          approval.status === 'eligible' &&
          author.toLowerCase() === approval.author_login?.toLowerCase() &&
          authorIdentities.get(author) === approval.author_nav_ident
        )
      })
      .map((approval) => ({ approverIdentityKey: approval.reviewer_nav_ident, commitShas: [approval.sha] })),
  })
}

type RepositoryDeliveryPrCoverage = 'approved' | 'not_approved' | 'unknown'

interface RepositoryDeliveryApprovalAssessmentInput {
  baseSha: string
  headSha: string
  commitHistoryComplete: boolean
  totalCommits: number | null
  commits: Array<{
    sha: string
    authorIdentityKey: string | null
    prCoverage: RepositoryDeliveryPrCoverage
  }>
  approvals: Array<{
    approverIdentityKey: string | null
    commitShas: string[]
  }>
}

type RepositoryDeliveryApprovalCommitStatus = 'covered' | 'not_covered' | 'unknown'

export interface RepositoryDeliveryApprovalAssessment {
  status: 'approved' | 'not_approved' | 'incomplete' | 'no_changes'
  totalCommits: number | null
  listedCommits: number
  omittedCommits: number
  commits: Array<{
    sha: string
    status: RepositoryDeliveryApprovalCommitStatus
    reason:
      | 'approved_pr'
      | 'manual_approval'
      | 'missing_approval'
      | 'unknown_pr_coverage'
      | 'unknown_commit_author'
      | 'unknown_approver_identity'
      | 'incomplete_commit_history'
      | 'invalid_interval'
      | 'duplicate_commit'
      | 'approval_outside_interval'
  }>
}

function normalizedIdentity(identityKey: string | null): string | null {
  const normalized = identityKey?.trim().toLowerCase()
  return normalized ? normalized : null
}

function unknownAssessment(
  input: RepositoryDeliveryApprovalAssessmentInput,
  reason: 'incomplete_commit_history' | 'invalid_interval' | 'duplicate_commit' | 'approval_outside_interval',
): RepositoryDeliveryApprovalAssessment {
  const omittedCommits = input.totalCommits === null ? 0 : Math.max(0, input.totalCommits - input.commits.length)
  return {
    status: 'incomplete',
    totalCommits: input.totalCommits,
    listedCommits: input.commits.length,
    omittedCommits,
    commits: input.commits.map((commit) => ({ sha: commit.sha, status: 'unknown', reason })),
  }
}

export function assessRepositoryDeliveryApproval(
  input: RepositoryDeliveryApprovalAssessmentInput,
): RepositoryDeliveryApprovalAssessment {
  if (
    !isFullCommitSha(input.baseSha) ||
    !isFullCommitSha(input.headSha) ||
    (input.totalCommits !== null &&
      (!Number.isSafeInteger(input.totalCommits) ||
        input.totalCommits < 0 ||
        input.totalCommits < input.commits.length ||
        (input.baseSha.toLowerCase() === input.headSha.toLowerCase()) !== (input.totalCommits === 0)))
  ) {
    return unknownAssessment(input, 'invalid_interval')
  }

  const commitShas = input.commits.map((commit) => commit.sha.toLowerCase())
  if (commitShas.some((sha) => !isFullCommitSha(sha))) {
    return unknownAssessment(input, 'invalid_interval')
  }

  if (new Set(commitShas).size !== commitShas.length) {
    return unknownAssessment(input, 'duplicate_commit')
  }

  const commitsBySha = new Map(input.commits.map((commit) => [commit.sha.toLowerCase(), commit]))
  const approvalCommitShas = input.approvals.flatMap((approval) => approval.commitShas.map((sha) => sha.toLowerCase()))
  if (approvalCommitShas.some((sha) => !isFullCommitSha(sha) || !commitsBySha.has(sha))) {
    return unknownAssessment(input, 'approval_outside_interval')
  }

  if (!input.commitHistoryComplete || input.totalCommits === null || input.totalCommits !== input.commits.length) {
    return unknownAssessment(input, 'incomplete_commit_history')
  }

  if (input.commits.length === 0) {
    return {
      status: 'no_changes',
      totalCommits: 0,
      listedCommits: 0,
      omittedCommits: 0,
      commits: [],
    }
  }

  if (!commitsBySha.has(input.headSha.toLowerCase()) || commitsBySha.has(input.baseSha.toLowerCase())) {
    return unknownAssessment(input, 'invalid_interval')
  }

  const assessmentCommits = input.commits.map((commit) => {
    if (commit.prCoverage === 'approved') {
      return { sha: commit.sha, status: 'covered' as const, reason: 'approved_pr' as const }
    }
    if (commit.prCoverage === 'unknown') {
      return { sha: commit.sha, status: 'unknown' as const, reason: 'unknown_pr_coverage' as const }
    }

    const authorIdentity = normalizedIdentity(commit.authorIdentityKey)
    if (!authorIdentity) {
      return { sha: commit.sha, status: 'unknown' as const, reason: 'unknown_commit_author' as const }
    }

    const commitApprovals = input.approvals.filter((approval) =>
      approval.commitShas.some((sha) => sha.toLowerCase() === commit.sha.toLowerCase()),
    )
    const approverIdentities = commitApprovals
      .map((approval) => normalizedIdentity(approval.approverIdentityKey))
      .filter((identity): identity is string => identity !== null)

    if (approverIdentities.some((identity) => identity !== authorIdentity)) {
      return { sha: commit.sha, status: 'covered' as const, reason: 'manual_approval' as const }
    }
    if (commitApprovals.some((approval) => !normalizedIdentity(approval.approverIdentityKey))) {
      return { sha: commit.sha, status: 'unknown' as const, reason: 'unknown_approver_identity' as const }
    }
    return { sha: commit.sha, status: 'not_covered' as const, reason: 'missing_approval' as const }
  })

  const status = assessmentCommits.some((commit) => commit.status === 'unknown')
    ? 'incomplete'
    : assessmentCommits.every((commit) => commit.status === 'covered')
      ? 'approved'
      : 'not_approved'

  return {
    status,
    totalCommits: input.totalCommits,
    listedCommits: input.commits.length,
    omittedCommits: 0,
    commits: assessmentCommits,
  }
}
