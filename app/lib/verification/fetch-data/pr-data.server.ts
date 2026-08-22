import {
  getAllLatestPrSnapshots,
  getLatestCommitSnapshot,
  saveCommitSnapshot,
  savePrSnapshotsBatch,
} from '~/db/github-data.server'
import { getDetailedPullRequestInfo, getPullRequestForCommit } from '~/lib/github'
import type { PrChecks, PrComment, PrCommit, PrMetadata, PrReview, VerificationInput } from '../types'
import { CURRENT_SCHEMA_VERSION } from '../types'

export interface FetchOptions {
  forceRefresh?: boolean
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
}

export async function fetchDeployedPrData(
  owner: string,
  repo: string,
  commitSha: string,
  baseBranch: string,
  options?: FetchOptions,
): Promise<{
  deployedPr: VerificationInput['deployedPr']
  mismatchedBaseBranches: string[]
  mismatchedPrNumbers: number[]
}> {
  const { prNumber, mismatchedBaseBranches, mismatchedPrNumbers } = await findPrForCommit(
    owner,
    repo,
    commitSha,
    baseBranch,
    { forceRefresh: options?.forceRefresh },
  )
  if (!prNumber) {
    return { deployedPr: null, mismatchedBaseBranches, mismatchedPrNumbers }
  }

  if (!options?.forceRefresh) {
    const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

    if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
      const metadata = cachedData.get('metadata')?.data as PrMetadata
      const reviews = cachedData.get('reviews')?.data as PrReview[]
      const commits = cachedData.get('commits')?.data as PrCommit[]

      if (!cachedData.has('checks') || !cachedData.has('comments')) {
      } else {
        return {
          deployedPr: {
            number: prNumber,
            url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            metadata,
            reviews,
            commits,
          },
          mismatchedBaseBranches,
          mismatchedPrNumbers,
        }
      }
    }
  }

  const { metadata, reviews, commits, checks, comments } = await fetchPrFromGitHub(owner, repo, prNumber)

  await savePrSnapshotsBatch(owner, repo, prNumber, [
    { dataType: 'metadata', data: metadata },
    { dataType: 'reviews', data: reviews },
    { dataType: 'commits', data: commits },
    { dataType: 'checks', data: checks },
    { dataType: 'comments', data: comments },
  ])

  return {
    deployedPr: {
      number: prNumber,
      url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      metadata,
      reviews,
      commits,
    },
    mismatchedBaseBranches,
    mismatchedPrNumbers,
  }
}

export async function findPrForCommit(
  owner: string,
  repo: string,
  commitSha: string,
  baseBranch?: string,
  options?: { cacheOnly?: boolean; forceRefresh?: boolean },
): Promise<{
  prNumber: number | null
  mismatchedBaseBranches: string[]
  mismatchedPrNumbers: number[]
}> {
  const cacheOnly = options?.cacheOnly ?? false
  const forceRefresh = options?.forceRefresh ?? false

  if (!forceRefresh) {
    const cached = await getLatestCommitSnapshot(owner, repo, commitSha, 'prs')
    if (cached && cached.schemaVersion >= CURRENT_SCHEMA_VERSION) {
      const prs = (cached.data as { prs: Array<{ number: number; baseBranch: string }> }).prs
      const matchingPrs = baseBranch ? prs.filter((pr) => pr.baseBranch === baseBranch) : prs
      const mismatchedPrs = baseBranch ? prs.filter((pr) => pr.baseBranch !== baseBranch) : []
      if (matchingPrs.length > 0) {
        return {
          prNumber: matchingPrs[0].number,
          mismatchedBaseBranches: mismatchedPrs.map((p) => p.baseBranch),
          mismatchedPrNumbers: mismatchedPrs.map((p) => p.number),
        }
      }
      if (cacheOnly || prs.length === 0) {
        return {
          prNumber: null,
          mismatchedBaseBranches: mismatchedPrs.map((p) => p.baseBranch),
          mismatchedPrNumbers: mismatchedPrs.map((p) => p.number),
        }
      }
    }
  }

  if (cacheOnly) {
    return { prNumber: null, mismatchedBaseBranches: [], mismatchedPrNumbers: [] }
  }

  const { pr, allAssociatedPrs } = await getPullRequestForCommit(owner, repo, commitSha, true, baseBranch)

  await saveCommitSnapshot(owner, repo, commitSha, 'prs', {
    prs: allAssociatedPrs.map((p) => ({ number: p.number, baseBranch: p.baseBranch })),
  })

  const mismatchedPrs = baseBranch ? allAssociatedPrs.filter((p) => p.baseBranch !== baseBranch) : []

  return {
    prNumber: pr?.number ?? null,
    mismatchedBaseBranches: mismatchedPrs.map((p) => p.baseBranch),
    mismatchedPrNumbers: mismatchedPrs.map((p) => p.number),
  }
}

export async function fetchPrFromGitHub(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{
  metadata: PrMetadata
  reviews: PrReview[]
  commits: PrCommit[]
  checks: PrChecks
  comments: PrComment[]
}> {
  const prData = await getDetailedPullRequestInfo(owner, repo, prNumber)

  if (!prData) {
    throw new Error(`Failed to fetch PR #${prNumber} from ${owner}/${repo}`)
  }

  const metadata: PrMetadata = {
    number: prNumber,
    title: prData.title,
    body: prData.body || null,
    state: prData.merged_at ? 'closed' : 'open',
    merged: !!prData.merged_at,
    draft: prData.draft,
    createdAt: prData.created_at,
    updatedAt: prData.created_at,
    mergedAt: prData.merged_at || null,
    closedAt: prData.merged_at || null,
    baseBranch: prData.base_branch,
    baseSha: prData.base_sha,
    headBranch: prData.head_branch,
    headSha: prData.head_sha,
    mergeCommitSha: prData.merge_commit_sha || null,
    author: {
      username: prData.creator.username,
      avatarUrl: prData.creator.avatar_url,
    },
    mergedBy: prData.merged_by
      ? {
          username: prData.merged_by.username,
          avatarUrl: prData.merged_by.avatar_url,
        }
      : null,
    labels: prData.labels,
    commitsCount: prData.commits_count,
    changedFiles: prData.changed_files,
    additions: prData.additions,
    deletions: prData.deletions,
    commentsCount: prData.comments_count,
    reviewCommentsCount: prData.review_comments_count,
    locked: prData.locked,
    mergeable: prData.mergeable,
    mergeableState: prData.mergeable_state,
    rebaseable: prData.rebaseable,
    maintainerCanModify: prData.maintainer_can_modify,
    autoMerge: prData.auto_merge
      ? {
          enabledBy: prData.auto_merge.enabled_by,
          mergeMethod: prData.auto_merge.merge_method,
        }
      : null,
    merger: prData.merger
      ? {
          username: prData.merger.username,
          avatarUrl: prData.merger.avatar_url,
        }
      : null,
    assignees: prData.assignees.map((a) => ({
      username: a.username,
      avatarUrl: a.avatar_url,
    })),
    requestedReviewers: prData.requested_reviewers.map((r) => ({
      username: r.username,
      avatarUrl: r.avatar_url,
    })),
    requestedTeams: prData.requested_teams.map((t) => ({
      name: t.name,
      slug: t.slug,
    })),
    milestone: prData.milestone,
    checksPassed: prData.checks_passed,
  }

  const reviews: PrReview[] = prData.reviewers.map((r, index) => ({
    id: index + 1,
    username: r.username,
    state: r.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED',
    submittedAt: r.submitted_at,
    body: null,
    commitId: r.commit_id ?? null,
  }))

  const commits: PrCommit[] = prData.commits.map((c) => ({
    sha: c.sha,
    message: c.message,
    authorUsername: c.author.username,
    authorLogin: c.author.login ?? null,
    authorDate: c.date,
    committerDate: c.committer_date || c.date,
    isMergeCommit: (c.parent_shas ?? []).length > 1,
    parentShas: c.parent_shas ?? [],
  }))

  const checks: PrChecks = {
    conclusion: prData.checks_passed === true ? 'success' : prData.checks_passed === false ? 'failure' : null,
    checkRuns: prData.checks.map((c) => ({
      id: c.id ?? 0,
      name: c.name,
      status: c.status as 'queued' | 'in_progress' | 'completed',
      conclusion: c.conclusion,
      startedAt: c.started_at,
      completedAt: c.completed_at,
      htmlUrl: c.html_url,
      headSha: c.head_sha,
      detailsUrl: c.details_url,
      externalId: c.external_id,
      checkSuiteId: c.check_suite_id,
      app: c.app ? { name: c.app.name, slug: c.app.slug } : null,
      output: c.output
        ? {
            title: c.output.title,
            summary: c.output.summary,
            text: c.output.text,
            annotationsCount: c.output.annotations_count,
          }
        : null,
    })),
    statuses: [],
  }

  const comments: PrComment[] = prData.comments.map((c) => ({
    id: c.id,
    username: c.user.username,
    body: c.body,
    createdAt: c.created_at,
    updatedAt: c.created_at,
  }))

  return { metadata, reviews, commits, checks, comments }
}
