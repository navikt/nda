import {
  assertNever,
  type ImplicitApprovalSettings,
  type PrCommit,
  type PrReview,
  type UnverifiedCommit,
  type UnverifiedReason,
} from './types'

export function isBaseBranchMergeCommit(message: string, baseBranch = 'main', parentShas?: string[]): boolean {
  if (parentShas !== undefined && parentShas.length < 2) {
    return false
  }
  const patterns = [
    new RegExp(`^Merge branch '${baseBranch}' into`, 'i'),
    new RegExp(`^Merge branch '${baseBranch === 'main' ? 'master' : 'main'}' into`, 'i'),
    new RegExp(`^Merge remote-tracking branch 'origin/${baseBranch}' into`, 'i'),
  ]
  return patterns.some((pattern) => pattern.test(message))
}

interface BaseMergeCheckResult {
  approved: boolean
  reason: string
}

export function shouldApproveWithBaseMerge(
  reviews: PrReview[],
  unverifiedCommits: UnverifiedCommit[],
  prCommits: PrCommit[],
  baseBranch = 'main',
): BaseMergeCheckResult {
  const approvals = reviews.filter((r) => r.state === 'APPROVED')
  if (approvals.length === 0) {
    return { approved: false, reason: 'no_approval' }
  }

  const mergeCommit = prCommits.find((c) => isBaseBranchMergeCommit(c.message, baseBranch, c.parentShas))
  if (!mergeCommit) {
    return { approved: false, reason: 'no_base_merge_commit_found' }
  }

  const mergeDate = new Date(mergeCommit.authorDate)

  for (const commit of unverifiedCommits) {
    if (commit.sha === mergeCommit.sha) continue

    const commitDate = new Date(commit.date)
    if (commitDate >= mergeDate) {
      return {
        approved: false,
        reason: `commit_${commit.sha.substring(0, 7)}_after_merge`,
      }
    }
  }

  return {
    approved: true,
    reason: `approved_with_base_merge:${mergeCommit.sha}`,
  }
}

export function checkImplicitApproval(params: {
  settings: ImplicitApprovalSettings
  prCreator: string
  lastCommitAuthor: string | null
  mergedBy: string
  allCommitAuthors: (string | null)[]
}): { qualifies: boolean; reason?: string } {
  const { settings, prCreator, lastCommitAuthor, mergedBy, allCommitAuthors } = params
  const { mode } = settings

  if (!mergedBy) {
    return { qualifies: false }
  }

  if (prCreator === 'unknown') {
    return { qualifies: false }
  }

  if (!lastCommitAuthor) {
    return { qualifies: false }
  }

  const mergedByLower = mergedBy.toLowerCase()
  const prCreatorLower = prCreator.toLowerCase()
  const lastCommitAuthorLower = lastCommitAuthor.toLowerCase()

  switch (mode) {
    case 'off':
      return { qualifies: false }

    case 'dependabot_only': {
      const isDependabotPR = prCreatorLower === 'dependabot[bot]'
      const onlyDependabotCommits =
        allCommitAuthors.length > 0 &&
        allCommitAuthors.every(
          (author) => author?.toLowerCase() === 'dependabot[bot]' || author?.toLowerCase() === 'dependabot',
        )

      if (
        isDependabotPR &&
        onlyDependabotCommits &&
        mergedByLower !== 'dependabot[bot]' &&
        mergedByLower !== 'dependabot'
      ) {
        return {
          qualifies: true,
          reason: 'Dependabot-PR med kun Dependabot-commits, merget av en annen bruker',
        }
      }
      return { qualifies: false }
    }

    case 'all': {
      if (mergedByLower !== prCreatorLower && mergedByLower !== lastCommitAuthorLower) {
        return {
          qualifies: true,
          reason: `Merget av ${mergedBy} som verken opprettet PR-en (${prCreator}) eller har siste commit (${lastCommitAuthor})`,
        }
      }
      return { qualifies: false }
    }

    default:
      return assertNever(mode, `Unhandled implicit approval mode: ${mode}`)
  }
}

export function extractApprovers(reviews: PrReview[]): string[] {
  return reviews.filter((r) => r.state === 'APPROVED').map((r) => r.username)
}

export function getLastCommitAuthor(commits: PrCommit[]): string | null {
  if (commits.length === 0) return null
  return commits[commits.length - 1].authorLogin
}

export function mapToUnverifiedReason(reason: string): UnverifiedReason {
  if (reason === 'no_pr') return 'no_pr'
  if (reason === 'no_approved_reviews') return 'no_approved_reviews'
  if (reason === 'approval_before_last_commit') return 'approval_before_last_commit'
  if (reason === 'self_approval') return 'self_approval'
  if (reason === 'unlinked_commit_author') return 'unlinked_commit_author'
  return 'pr_not_approved'
}

export function latestCommitDate(commit: PrCommit): Date {
  const author = new Date(commit.authorDate).getTime()
  const committer = new Date(commit.committerDate).getTime()
  return new Date(Math.max(author, committer))
}
