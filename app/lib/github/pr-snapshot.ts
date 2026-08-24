import type { RestEndpointMethodTypes } from '@octokit/rest'
import type { GitHubPRData } from '~/db/deployments.server'

export type RawPr = RestEndpointMethodTypes['pulls']['get']['response']['data']
export type RawPrReview = RestEndpointMethodTypes['pulls']['listReviews']['response']['data'][number]
export type RawPrCommit = RestEndpointMethodTypes['pulls']['listCommits']['response']['data'][number]
export type RawIssueComment = RestEndpointMethodTypes['issues']['listComments']['response']['data'][number]
export type RawReviewComment = RestEndpointMethodTypes['pulls']['listReviewComments']['response']['data'][number]

export interface RawPrSnapshotData {
  pr: RawPr
  reviews: RawPrReview[]
  commits: RawPrCommit[]
  issueComments: RawIssueComment[]
  reviewComments: RawReviewComment[]
}

export interface ApiVersionMetadata {
  apiVersion: string
  apiDeprecatedAt: string | null
  apiSunsetAt: string | null
}

export function captureApiVersionMetadata(
  headers: Record<string, unknown>,
  current: ApiVersionMetadata | null,
): ApiVersionMetadata {
  const headerVersion = headers['x-github-api-version-selected'] as string | undefined
  return {
    apiVersion:
      current?.apiVersion && current.apiVersion !== 'unknown' ? current.apiVersion : (headerVersion ?? 'unknown'),
    apiDeprecatedAt: current?.apiDeprecatedAt ?? (headers.deprecation as string | undefined) ?? null,
    apiSunsetAt: current?.apiSunsetAt ?? (headers.sunset as string | undefined) ?? null,
  }
}

export interface PrMetadataFields {
  title: string
  body: string | null
  labels: string[]
  created_at: string
  merged_at: string | null
  base_branch: string
  base_sha: string
  head_branch: string
  head_sha: string
  merge_commit_sha: string | null
  commits_count: number
  changed_files: number
  additions: number
  deletions: number
  comments_count: number
  review_comments_count: number
  draft: boolean
  mergeable: boolean | null
  mergeable_state: string | null
  rebaseable: boolean | null
  locked: boolean
  maintainer_can_modify: boolean
  auto_merge: GitHubPRData['auto_merge']
  creator: GitHubPRData['creator']
  merged_by: GitHubPRData['merged_by']
  merger: GitHubPRData['merger']
  assignees: GitHubPRData['assignees']
  requested_reviewers: GitHubPRData['requested_reviewers']
  requested_teams: GitHubPRData['requested_teams']
  milestone: GitHubPRData['milestone']
}

export function mapPrMetadata(pr: RawPr): PrMetadataFields {
  return {
    title: pr.title,
    body: pr.body,
    labels: pr.labels.map((label) => (typeof label === 'string' ? label : label.name || '')),
    created_at: pr.created_at,
    merged_at: pr.merged_at,
    base_branch: pr.base.ref,
    base_sha: pr.base.sha,
    head_branch: pr.head.ref,
    head_sha: pr.head.sha,
    merge_commit_sha: pr.merge_commit_sha,
    commits_count: pr.commits,
    changed_files: pr.changed_files,
    additions: pr.additions,
    deletions: pr.deletions,
    comments_count: pr.comments,
    review_comments_count: pr.review_comments,
    draft: pr.draft || false,
    mergeable: pr.mergeable,
    mergeable_state: pr.mergeable_state,
    rebaseable: pr.rebaseable ?? null,
    locked: pr.locked,
    maintainer_can_modify: pr.maintainer_can_modify,
    auto_merge: pr.auto_merge
      ? {
          enabled_by: pr.auto_merge.enabled_by?.login || 'unknown',
          merge_method: pr.auto_merge.merge_method,
        }
      : null,
    creator: {
      username: pr.user?.login || 'unknown',
      avatar_url: pr.user?.avatar_url || '',
    },
    merged_by: pr.merged_by
      ? {
          username: pr.merged_by.login,
          avatar_url: pr.merged_by.avatar_url,
        }
      : null,
    merger: pr.merged_by
      ? {
          username: pr.merged_by.login,
          avatar_url: pr.merged_by.avatar_url,
        }
      : null,
    assignees: (pr.assignees || []).map((a) => ({
      username: a.login,
      avatar_url: a.avatar_url,
    })),
    requested_reviewers: (pr.requested_reviewers || []).map((r) => ({
      username: r.login,
      avatar_url: r.avatar_url,
    })),
    requested_teams: (pr.requested_teams || []).map((t) => ({
      name: t.name,
      slug: t.slug,
    })),
    milestone: pr.milestone
      ? {
          title: pr.milestone.title,
          number: pr.milestone.number,
          state: pr.milestone.state,
        }
      : null,
  }
}

export function mapPrReviews(allReviews: RawPrReview[]): GitHubPRData['reviewers'] {
  const reviewsByUser = new Map<
    string,
    { username: string; avatar_url: string; state: string; submitted_at: string; commit_id: string | null }
  >()

  for (const review of allReviews) {
    if (!review.user || !review.submitted_at) continue

    const existing = reviewsByUser.get(review.user.login)

    let shouldUpdate = false
    if (!existing) {
      shouldUpdate = true
    } else if (review.state === 'APPROVED' && existing.state !== 'APPROVED') {
      shouldUpdate = true
    } else if (review.state === 'APPROVED' && existing.state === 'APPROVED') {
      shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
    } else if (review.state !== 'APPROVED' && existing.state !== 'APPROVED') {
      shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
    }

    if (shouldUpdate) {
      reviewsByUser.set(review.user.login, {
        username: review.user.login,
        avatar_url: review.user.avatar_url,
        state: review.state,
        submitted_at: review.submitted_at,
        commit_id: review.commit_id ?? null,
      })
    }
  }

  return Array.from(reviewsByUser.values())
}

export interface PrReviewBodyComment {
  id: number
  body: string
  user: { username: string; avatar_url: string }
  created_at: string
  html_url: string
}

export function mapPrReviewBodyComments(allReviews: RawPrReview[]): PrReviewBodyComment[] {
  const reviewBodyComments: PrReviewBodyComment[] = []

  for (const review of allReviews) {
    if (review.user && review.submitted_at && review.body?.trim()) {
      reviewBodyComments.push({
        id: review.id,
        body: review.body,
        user: {
          username: review.user.login,
          avatar_url: review.user.avatar_url,
        },
        created_at: review.submitted_at,
        html_url: review.html_url,
      })
    }
  }

  return reviewBodyComments
}

export function mapPrCommits(allCommitsData: RawPrCommit[]): GitHubPRData['commits'] {
  return allCommitsData.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
    author: {
      username: commit.author?.login || commit.commit.author?.name || 'unknown',
      login: commit.author?.login ?? null,
      avatar_url: commit.author?.avatar_url || '',
    },
    date: commit.commit.author?.date || '',
    committer_date: commit.commit.committer?.date || commit.commit.author?.date || '',
    parent_shas: (commit.parents ?? []).map((p) => p.sha),
    html_url: commit.html_url,
  }))
}

export function mapPrComments(
  allIssueComments: RawIssueComment[],
  allReviewComments: RawReviewComment[],
): GitHubPRData['comments'] {
  const issueComments = allIssueComments.map((comment) => ({
    id: comment.id,
    body: comment.body || '',
    user: {
      username: comment.user?.login || 'unknown',
      avatar_url: comment.user?.avatar_url || '',
    },
    created_at: comment.created_at,
    html_url: comment.html_url,
  }))

  const reviewComments = allReviewComments.map((comment) => ({
    id: comment.id,
    body: comment.body || '',
    user: {
      username: comment.user?.login || 'unknown',
      avatar_url: comment.user?.avatar_url || '',
    },
    created_at: comment.created_at,
    html_url: comment.html_url,
  }))

  return [...issueComments, ...reviewComments]
}

export function derivePrDataFromRaw(raw: RawPrSnapshotData): GitHubPRData {
  const reviewBodyComments = mapPrReviewBodyComments(raw.reviews)
  const baseComments = mapPrComments(raw.issueComments, raw.reviewComments)
  const comments = [...baseComments, ...reviewBodyComments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  return {
    ...mapPrMetadata(raw.pr),
    reviewers: mapPrReviews(raw.reviews),
    checks_passed: null,
    checks: [],
    commits: mapPrCommits(raw.commits),
    comments,
  }
}
