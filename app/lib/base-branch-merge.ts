export function isBaseBranchMergeCommit(message: string, baseBranch = 'main'): boolean {
  const patterns = [
    new RegExp(`^Merge branch '${baseBranch}' into`, 'i'),
    new RegExp(`^Merge branch '${baseBranch === 'main' ? 'master' : 'main'}' into`, 'i'),
    new RegExp(`^Merge remote-tracking branch 'origin/${baseBranch}' into`, 'i'),
  ]

  return patterns.some((pattern) => pattern.test(message))
}

interface CommitInfo {
  sha: string
  message: string
  author?: string
  date?: string
}

interface BaseMergeCheckResult {
  canExplain: boolean
  reason?: string
  mergeCommitSha?: string
}

export function canExplainUnverifiedByBaseMerge(
  unverifiedCommits: CommitInfo[],
  prCommits: CommitInfo[],
  baseBranch = 'main',
): BaseMergeCheckResult {
  if (unverifiedCommits.length === 0) {
    return { canExplain: true, reason: 'no_unverified_commits' }
  }

  const mergeCommit = prCommits.find((c) => isBaseBranchMergeCommit(c.message, baseBranch))

  if (!mergeCommit) {
    return { canExplain: false, reason: 'no_base_merge_commit_found' }
  }

  if (!mergeCommit.date) {
    const mergeIndex = prCommits.findIndex((c) => c.sha === mergeCommit.sha)

    for (const commit of unverifiedCommits) {
      if (commit.sha === mergeCommit.sha) continue

      const commitIndex = prCommits.findIndex((c) => c.sha === commit.sha)
      if (commitIndex > mergeIndex) {
        return {
          canExplain: false,
          reason: `commit_${commit.sha.substring(0, 7)}_after_merge_in_list`,
        }
      }
    }

    return {
      canExplain: true,
      reason: 'all_unverified_from_base_branch',
      mergeCommitSha: mergeCommit.sha,
    }
  }

  const mergeDate = new Date(mergeCommit.date)

  for (const commit of unverifiedCommits) {
    if (commit.sha === mergeCommit.sha) {
      continue
    }

    if (!commit.date) {
      const mergeIndex = prCommits.findIndex((c) => c.sha === mergeCommit.sha)
      const commitIndex = prCommits.findIndex((c) => c.sha === commit.sha)

      if (commitIndex === -1 || commitIndex > mergeIndex) {
        return {
          canExplain: false,
          reason: `commit_${commit.sha.substring(0, 7)}_position_unknown`,
        }
      }
      continue
    }

    const commitDate = new Date(commit.date)
    if (commitDate >= mergeDate) {
      return {
        canExplain: false,
        reason: `commit_${commit.sha.substring(0, 7)}_after_merge`,
      }
    }
  }

  return {
    canExplain: true,
    reason: 'all_unverified_from_base_branch',
    mergeCommitSha: mergeCommit.sha,
  }
}

interface ReviewInfo {
  state: string
}

interface ApprovalResult {
  approved: boolean
  reason: string
}

export function shouldApproveWithBaseMerge(
  reviews: ReviewInfo[],
  unverifiedCommits: CommitInfo[],
  prCommits: CommitInfo[],
  baseBranch = 'main',
): ApprovalResult {
  const approvals = reviews.filter((r) => r.state === 'APPROVED')
  if (approvals.length === 0) {
    return { approved: false, reason: 'no_approval' }
  }

  const baseMergeCheck = canExplainUnverifiedByBaseMerge(unverifiedCommits, prCommits, baseBranch)

  if (!baseMergeCheck.canExplain) {
    return { approved: false, reason: baseMergeCheck.reason || 'unexplained_commits' }
  }

  return {
    approved: true,
    reason: `approved_with_base_merge:${baseMergeCheck.mergeCommitSha}`,
  }
}
