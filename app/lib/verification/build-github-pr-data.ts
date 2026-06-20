/**
 * Builds a GitHubPRData object from V2 snapshots.
 *
 * Maps from V2 camelCase snapshot types to V1 snake_case GitHubPRData format
 * used by the UI and PDF reports.
 */
import type { GitHubPRData } from '~/db/deployments.server'
import type { PrChecks, PrComment, PrCommit, PrMetadata, PrReview } from './types'

/**
 * Determines which SHA the checks were fetched for by comparing a check run's
 * headSha against the PR's merge commit SHA and head SHA.
 * Uses the first check run that actually has headSha populated.
 * Works for both freshly fetched and cached check data.
 */
function deriveChecksRef(
  checks: PrChecks | null,
  mergeCommitSha: string | null | undefined,
  headSha: string,
): 'merge_commit' | 'head' | null {
  if (!checks || checks.checkRuns.length === 0) return null
  if (!mergeCommitSha) return null // open PR — not relevant
  const refSha = checks.checkRuns.find((cr) => cr.headSha)?.headSha
  // If no check run has headSha (older cached data), assume branch — all data
  // cached before 2026-06-20 was fetched from head.sha due to a bug
  if (!refSha) return 'head'
  if (refSha === mergeCommitSha) return 'merge_commit'
  if (refSha === headSha) return 'head'
  return null
}

export function buildGithubPrDataFromSnapshots(
  metadata: PrMetadata,
  reviews: PrReview[] | null,
  commits: PrCommit[] | null,
  checks: PrChecks | null,
  comments: PrComment[] | null,
): GitHubPRData {
  const mapUser = (user: { username: string; avatarUrl?: string } | null) =>
    user ? { username: user.username, avatar_url: user.avatarUrl ?? '' } : null

  return {
    title: metadata.title,
    body: metadata.body ?? null,
    labels: metadata.labels ?? [],
    created_at: metadata.createdAt,
    merged_at: metadata.mergedAt ?? null,
    base_branch: metadata.baseBranch,
    base_sha: metadata.baseSha,
    head_branch: metadata.headBranch,
    head_sha: metadata.headSha,
    merge_commit_sha: metadata.mergeCommitSha ?? null,
    commits_count: metadata.commitsCount,
    changed_files: metadata.changedFiles,
    additions: metadata.additions,
    deletions: metadata.deletions,
    comments_count: metadata.commentsCount ?? 0,
    review_comments_count: metadata.reviewCommentsCount ?? 0,
    draft: metadata.draft,
    mergeable: metadata.mergeable ?? null,
    mergeable_state: metadata.mergeableState ?? null,
    rebaseable: metadata.rebaseable ?? null,
    locked: metadata.locked ?? false,
    maintainer_can_modify: metadata.maintainerCanModify ?? false,
    auto_merge: metadata.autoMerge
      ? { enabled_by: metadata.autoMerge.enabledBy, merge_method: metadata.autoMerge.mergeMethod }
      : null,
    creator: mapUser(metadata.author) ?? { username: 'ukjent', avatar_url: '' },
    merged_by: mapUser(metadata.mergedBy ?? null),
    merger: mapUser(metadata.merger ?? null),
    assignees: (metadata.assignees ?? []).map((a) => ({ username: a.username, avatar_url: a.avatarUrl ?? '' })),
    requested_reviewers: (metadata.requestedReviewers ?? []).map((r) => ({
      username: r.username,
      avatar_url: r.avatarUrl ?? '',
    })),
    requested_teams: (metadata.requestedTeams ?? []).map((t) => ({ name: t.name, slug: t.slug })),
    milestone: metadata.milestone ?? null,
    checks_passed: metadata.checksPassed ?? (checks ? checks.conclusion === 'success' : null),
    checks_ref: deriveChecksRef(checks, metadata.mergeCommitSha, metadata.headSha),
    reviewers: (reviews ?? []).map((r) => ({
      username: r.username,
      avatar_url: '',
      state: r.state,
      submitted_at: r.submittedAt,
    })),
    commits: (commits ?? []).map((c) => ({
      sha: c.sha,
      message: c.message,
      author: { username: c.authorUsername ?? 'unknown', avatar_url: '' },
      date: c.authorDate,
      html_url: '',
    })),
    checks: (checks?.checkRuns ?? []).map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion ?? null,
      started_at: cr.startedAt ?? null,
      completed_at: cr.completedAt ?? null,
      html_url: cr.htmlUrl ?? null,
      head_sha: cr.headSha,
      details_url: cr.detailsUrl ?? null,
      external_id: cr.externalId ?? null,
      check_suite_id: cr.checkSuiteId ?? null,
      app: cr.app ? { name: cr.app.name, slug: cr.app.slug ?? null } : null,
      output: cr.output
        ? {
            title: cr.output.title ?? null,
            summary: cr.output.summary ?? null,
            text: cr.output.text ?? null,
            annotations_count: cr.output.annotationsCount ?? 0,
          }
        : null,
    })),
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      body: c.body,
      user: { username: c.username, avatar_url: '' },
      created_at: c.createdAt,
      html_url: '',
    })),
  }
}
