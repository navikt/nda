import {
  assertNever,
  type CompareSummary,
  type ImplicitApprovalSettings,
  type PrCommit,
  type PrReview,
  type UnverifiedCommit,
  type UnverifiedReason,
  type VerificationInput,
  type VerificationResult,
} from './types'

export function verifyDeployment(input: VerificationInput): VerificationResult {
  if (input.repositoryStatus !== 'active') {
    return handleUnauthorizedRepository(input)
  }

  if (input.commitOnBaseBranch === false) {
    return handleUnauthorizedBranch(input)
  }

  if (!input.previousDeployment) {
    return handlePendingBaseline(input)
  }

  if (input.commitsBetween.length === 0) {
    if (input.compareFailed) {
      return handleCompareError(
        input,
        `GitHub compare API failed for ${input.repository}. Check that the GitHub App has access to this repository.`,
      )
    }
    if (input.compareSummary?.noDiffDetected) {
      return handleNoChanges(input, describeNoDiff(input.compareSummary))
    }
    if (input.commitSha === input.previousDeployment.commitSha) {
      return handleNoChanges(input)
    }
    if (input.nearbyApprovedDeployWithSameCommit) {
      return buildResult(input, {
        hasFourEyes: true,
        status: 'no_changes',
        approvalDetails: {
          method: 'no_changes',
          approvers: [],
          reason: `Same commit verified in nearby deployment #${input.nearbyApprovedDeployWithSameCommit.deploymentId} (status: ${input.nearbyApprovedDeployWithSameCommit.status}). GitHub compare returned 0 commits — likely a retry/duplicate deploy.`,
        },
      })
    }
    if (input.nearbyApprovedDeploy) {
      return buildResult(input, {
        hasFourEyes: true,
        status: 'no_changes',
        approvalDetails: {
          method: 'no_changes',
          approvers: [],
          reason: `Superseded deploy — commit is ancestor of nearby approved deployment #${input.nearbyApprovedDeploy.deploymentId} (${input.nearbyApprovedDeploy.commitSha.substring(0, 7)}, status: ${input.nearbyApprovedDeploy.status}). All code in this deploy is already included in the approved deploy.`,
        },
      })
    }
    return handleCompareError(
      input,
      `Commit SHAs differ (${input.previousDeployment.commitSha.substring(0, 7)}→${input.commitSha.substring(0, 7)}) but GitHub compare returned 0 commits. Possible rollback or branch divergence.`,
    )
  }

  const unverifiedCommits = findUnverifiedCommits(input)

  if (unverifiedCommits.length === 0) {
    return handleAllCommitsVerified(input)
  }

  if (input.deployedPr) {
    const baseMergeResult = handleBaseBranchMerge(input, unverifiedCommits)
    if (baseMergeResult) return baseMergeResult
  }

  if (input.deployedPr && input.implicitApprovalSettings.mode !== 'off') {
    const implicitResult = handleImplicitApproval(input)
    if (implicitResult) return implicitResult
  }

  return handleUnverifiedCommits(input, unverifiedCommits)
}

function handleUnauthorizedRepository(input: VerificationInput): VerificationResult {
  return buildResult(input, {
    hasFourEyes: false,
    status: 'unauthorized_repository',
    approvalDetails: {
      method: null,
      approvers: [],
      reason: `Repository status: ${input.repositoryStatus}`,
    },
  })
}

function handleUnauthorizedBranch(input: VerificationInput): VerificationResult {
  return buildResult(input, {
    hasFourEyes: false,
    status: 'unauthorized_branch',
    approvalDetails: {
      method: null,
      approvers: [],
      reason: `Deployed commit is not on base branch '${input.baseBranch}'`,
    },
  })
}

function handlePendingBaseline(input: VerificationInput): VerificationResult {
  return buildResult(input, {
    hasFourEyes: false,
    status: 'pending_baseline',
    approvalDetails: {
      method: 'pending_baseline',
      approvers: [],
      reason: 'First deployment - no previous deployment to compare against',
    },
  })
}

function handleNoChanges(
  input: VerificationInput,
  reason = 'No new commits since previous deployment',
): VerificationResult {
  return buildResult(input, {
    hasFourEyes: true,
    status: 'no_changes',
    approvalDetails: {
      method: 'no_changes',
      approvers: [],
      reason,
    },
  })
}

function describeNoDiff(summary: CompareSummary): string {
  if (summary.changedFiles === 0) {
    if (summary.status === 'identical') {
      return 'GitHub compare reported identical refs/commit with 0 changed files'
    }
    return `GitHub compare returned 0 commits and 0 changed files (status: ${summary.status})`
  }

  return `GitHub compare returned no diff (status: ${summary.status}, ${summary.changedFiles} changed files)`
}

function handleCompareError(input: VerificationInput, reason: string): VerificationResult {
  return buildResult(input, {
    hasFourEyes: false,
    status: 'error',
    approvalDetails: {
      method: null,
      approvers: [],
      reason,
    },
  })
}

function findUnverifiedCommits(input: VerificationInput): UnverifiedCommit[] {
  const unverifiedCommits: UnverifiedCommit[] = []
  const deployedPrCommitShas = new Set(input.deployedPr?.commits.map((c) => c.sha) ?? [])
  const deployedPrMergeCommitSha = input.deployedPr?.metadata.mergeCommitSha ?? null

  let deployedPrApproval: { hasFourEyes: boolean; reason: string } | null = null
  if (input.deployedPr) {
    deployedPrApproval = verifyFourEyesFromPrData({
      reviewers: input.deployedPr.reviews,
      commits: input.deployedPr.commits,
      baseBranch: input.deployedPr.metadata.baseBranch,
      mergedBy: input.deployedPr.metadata.mergedBy?.username,
    })
  }

  for (const commit of input.commitsBetween) {
    if (commit.isMergeCommit) {
      if (isBaseBranchMergeCommit(commit.message, input.baseBranch)) {
        continue
      }
    }

    if (input.deployedPr && (deployedPrCommitShas.has(commit.sha) || commit.sha === deployedPrMergeCommitSha)) {
      if (deployedPrApproval?.hasFourEyes) {
        continue
      }
      unverifiedCommits.push({
        sha: commit.sha,
        message: commit.message.split('\n')[0],
        author: commit.authorUsername,
        date: commit.authorDate,
        htmlUrl: commit.htmlUrl,
        prNumber: input.deployedPr.number,
        reason: mapToUnverifiedReason(deployedPrApproval?.reason || 'pr_not_approved'),
      })
      continue
    }

    if (commit.pr) {
      const prApproval = verifyFourEyesFromPrData({
        reviewers: commit.pr.reviews,
        commits: commit.pr.commits,
        baseBranch: commit.pr.baseBranch,
      })

      if (prApproval.hasFourEyes) {
        continue
      }

      unverifiedCommits.push({
        sha: commit.sha,
        message: commit.message.split('\n')[0],
        author: commit.authorUsername,
        date: commit.authorDate,
        htmlUrl: commit.htmlUrl,
        prNumber: commit.pr.number,
        reason: mapToUnverifiedReason(prApproval.reason),
      })
      continue
    }

    unverifiedCommits.push({
      sha: commit.sha,
      message: commit.message.split('\n')[0],
      author: commit.authorUsername,
      date: commit.authorDate,
      htmlUrl: commit.htmlUrl,
      prNumber: null,
      reason: 'no_pr',
    })
  }

  return unverifiedCommits
}

function handleAllCommitsVerified(input: VerificationInput): VerificationResult {
  return buildResult(input, {
    hasFourEyes: true,
    status: 'approved',
    approvalDetails: {
      method: 'pr_review',
      approvers: extractApprovers(input.deployedPr?.reviews ?? []),
      reason: `All ${input.commitsBetween.length} commit(s) verified via PR review`,
    },
  })
}

function handleBaseBranchMerge(
  input: VerificationInput,
  unverifiedCommits: UnverifiedCommit[],
): VerificationResult | null {
  if (!input.deployedPr || unverifiedCommits.length === 0) return null

  const baseMergeResult = shouldApproveWithBaseMerge(
    input.deployedPr.reviews,
    unverifiedCommits,
    input.deployedPr.commits,
    input.deployedPr.metadata.baseBranch,
  )

  if (!baseMergeResult.approved) return null

  return buildResult(input, {
    hasFourEyes: true,
    status: 'approved',
    approvalDetails: {
      method: 'base_merge',
      approvers: extractApprovers(input.deployedPr.reviews),
      reason: baseMergeResult.reason,
    },
  })
}

function handleImplicitApproval(input: VerificationInput): VerificationResult | null {
  if (!input.deployedPr) return null

  const implicitResult = checkImplicitApproval({
    settings: input.implicitApprovalSettings,
    prCreator: input.deployedPr.metadata.author.username,
    lastCommitAuthor: getLastCommitAuthor(input.deployedPr.commits),
    mergedBy: input.deployedPr.metadata.mergedBy?.username ?? '',
    allCommitAuthors: input.deployedPr.commits.map((c) => c.authorUsername),
  })

  if (!implicitResult.qualifies) return null

  return buildResult(input, {
    hasFourEyes: true,
    status: 'implicitly_approved',
    approvalDetails: {
      method: 'implicit',
      approvers: input.deployedPr.metadata.mergedBy ? [input.deployedPr.metadata.mergedBy.username] : [],
      reason: implicitResult.reason ?? 'Implicit approval',
    },
  })
}

function handleUnverifiedCommits(input: VerificationInput, unverifiedCommits: UnverifiedCommit[]): VerificationResult {
  return buildResult(input, {
    hasFourEyes: false,
    status: 'unverified_commits',
    unverifiedCommits,
    approvalDetails: {
      method: null,
      approvers: [],
      reason: `${unverifiedCommits.length} commit(s) not verified`,
    },
  })
}

function buildResult(
  input: VerificationInput,
  fields: Pick<VerificationResult, 'hasFourEyes' | 'status' | 'approvalDetails'> & {
    unverifiedCommits?: UnverifiedCommit[]
  },
): VerificationResult {
  return {
    hasFourEyes: fields.hasFourEyes,
    status: fields.status,
    deployedPr: input.deployedPr
      ? {
          number: input.deployedPr.number,
          url: input.deployedPr.url,
          title: input.deployedPr.metadata.title,
          author: input.deployedPr.metadata.author.username,
        }
      : null,
    unverifiedCommits: fields.unverifiedCommits ?? [],
    approvalDetails: fields.approvalDetails,
    verifiedAt: new Date(),
    schemaVersion: input.dataFreshness.schemaVersion,
  }
}

interface PrDataForVerification {
  reviewers: PrReview[]
  commits: PrCommit[]
  baseBranch: string
  mergedBy?: string | null
}

export function verifyFourEyesFromPrData(prData: PrDataForVerification): {
  hasFourEyes: boolean
  reason: string
} {
  const { reviewers, commits, baseBranch, mergedBy } = prData

  if (commits.length === 0) {
    return { hasFourEyes: false, reason: 'No commits found in PR' }
  }

  let lastRealCommit = commits[commits.length - 1]
  let lastRealCommitIndex = commits.length - 1

  for (let i = commits.length - 1; i >= 0; i--) {
    const commit = commits[i]
    if (!isBaseBranchMergeCommit(commit.message, baseBranch)) {
      lastRealCommit = commit
      lastRealCommitIndex = i
      break
    }
  }

  const lastRealCommitDate = latestCommitDate(lastRealCommit)

  const approvedReviewsAfterLastCommit = reviewers.filter((review) => {
    if (review.state !== 'APPROVED' || !review.submittedAt) {
      return false
    }
    return new Date(review.submittedAt) > lastRealCommitDate
  })

  if (approvedReviewsAfterLastCommit.length > 0) {
    const reason =
      lastRealCommitIndex < commits.length - 1
        ? `Approved by ${approvedReviewsAfterLastCommit[0].username} (after ignoring ${commits.length - 1 - lastRealCommitIndex} base-merge commit(s))`
        : `Approved by ${approvedReviewsAfterLastCommit[0].username} after last commit`
    return { hasFourEyes: true, reason }
  }

  const approvedReviews = reviewers.filter((r) => r.state === 'APPROVED')
  if (approvedReviews.length === 0) {
    return { hasFourEyes: false, reason: 'no_approved_reviews' }
  }

  if (mergedBy) {
    const mergedByLower = mergedBy.toLowerCase()
    const commitAuthors = new Set(commits.map((c) => c.authorUsername.toLowerCase()))
    if (!commitAuthors.has(mergedByLower)) {
      return {
        hasFourEyes: true,
        reason: `Approved by ${approvedReviews[0].username} (before last commit), merged by ${mergedBy} who is not a commit author`,
      }
    }
  }

  return { hasFourEyes: false, reason: 'approval_before_last_commit' }
}

function isBaseBranchMergeCommit(message: string, baseBranch = 'main'): boolean {
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

function shouldApproveWithBaseMerge(
  reviews: PrReview[],
  unverifiedCommits: UnverifiedCommit[],
  prCommits: PrCommit[],
  baseBranch = 'main',
): BaseMergeCheckResult {
  const approvals = reviews.filter((r) => r.state === 'APPROVED')
  if (approvals.length === 0) {
    return { approved: false, reason: 'no_approval' }
  }

  const mergeCommit = prCommits.find((c) => isBaseBranchMergeCommit(c.message, baseBranch))
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
  lastCommitAuthor: string
  mergedBy: string
  allCommitAuthors: string[]
}): { qualifies: boolean; reason?: string } {
  const { settings, prCreator, lastCommitAuthor, mergedBy, allCommitAuthors } = params
  const { mode } = settings

  const mergedByLower = mergedBy.toLowerCase()
  const prCreatorLower = prCreator.toLowerCase()
  const lastCommitAuthorLower = lastCommitAuthor.toLowerCase()

  switch (mode) {
    case 'off':
      return { qualifies: false }

    case 'dependabot_only': {
      const isDependabotPR = prCreatorLower === 'dependabot[bot]'
      const onlyDependabotCommits = allCommitAuthors.every(
        (author) => author.toLowerCase() === 'dependabot[bot]' || author.toLowerCase() === 'dependabot',
      )

      if (isDependabotPR && onlyDependabotCommits && mergedByLower !== prCreatorLower) {
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

function extractApprovers(reviews: PrReview[]): string[] {
  return reviews.filter((r) => r.state === 'APPROVED').map((r) => r.username)
}

function getLastCommitAuthor(commits: PrCommit[]): string {
  if (commits.length === 0) return ''
  return commits[commits.length - 1].authorUsername
}

function mapToUnverifiedReason(reason: string): UnverifiedReason {
  if (reason === 'no_pr') return 'no_pr'
  if (reason === 'no_approved_reviews') return 'no_approved_reviews'
  if (reason === 'approval_before_last_commit') return 'approval_before_last_commit'
  return 'pr_not_approved'
}

function latestCommitDate(commit: PrCommit): Date {
  const author = new Date(commit.authorDate).getTime()
  const committer = new Date(commit.committerDate).getTime()
  return new Date(Math.max(author, committer))
}
