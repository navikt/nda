import type { GitHubPRData } from '~/db/deployments.server'
import {
  getAllLatestPrRawSnapshots,
  getAllLatestPrSnapshots,
  getLatestCommitSnapshot,
  saveCommitSnapshot,
  savePrRawSnapshotsBatch,
} from '~/db/github-data.server'
import {
  getDetailedPullRequestInfo,
  getDisplayDataFromGitHub,
  getMutablePrDataFromGitHub,
  getPullRequestForCommit,
} from '~/lib/github'
import type {
  ApiVersionMetadata,
  RawIssueComment,
  RawPr,
  RawPrCommit,
  RawPrReview,
  RawPrSnapshotData,
  RawReviewComment,
} from '~/lib/github/pr-snapshot'
import { derivePrDataFromRaw } from '~/lib/github/pr-snapshot'
import { buildGithubPrDataFromSnapshots } from '../build-github-pr-data'
import type { PrChecks, PrComment, PrCommit, PrMetadata, PrReview, VerificationInput } from '../types'
import { CURRENT_SCHEMA_VERSION } from '../types'

export async function getDerivedPrDataFromRawSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubPRData | null> {
  const rawSnapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber)
  const prSnapshot = rawSnapshots.get('pr')
  if (!prSnapshot) return null

  if (!rawSnapshots.has('reviews') || !rawSnapshots.has('commits')) return null

  const raw: RawPrSnapshotData = {
    pr: prSnapshot.data as RawPr,
    reviews: rawSnapshots.get('reviews')?.data as RawPrReview[],
    commits: rawSnapshots.get('commits')?.data as RawPrCommit[],
    issueComments: (rawSnapshots.get('comments')?.data as RawIssueComment[]) ?? [],
    reviewComments: (rawSnapshots.get('review_comments')?.data as RawReviewComment[]) ?? [],
  }

  return derivePrDataFromRaw(raw)
}

export type LegacyPrDataType = 'reviews' | 'commits' | 'checks' | 'comments'

async function getLegacyPrData(
  owner: string,
  repo: string,
  prNumber: number,
  requiredTypes: LegacyPrDataType[] = [],
): Promise<GitHubPRData | null> {
  const snapshots = await getAllLatestPrSnapshots(owner, repo, prNumber)
  const metadata = snapshots.get('metadata')?.data as PrMetadata | undefined
  if (!metadata) return null
  if (requiredTypes.some((type) => !snapshots.has(type))) return null

  const reviews = (snapshots.get('reviews')?.data as PrReview[]) ?? null
  const commits = (snapshots.get('commits')?.data as PrCommit[]) ?? null
  const checks = (snapshots.get('checks')?.data as PrChecks) ?? null
  const comments = (snapshots.get('comments')?.data as PrComment[]) ?? null

  return buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)
}

export async function getCachedPrData(
  owner: string,
  repo: string,
  prNumber: number,
  requiredLegacyTypes: LegacyPrDataType[] = [],
): Promise<GitHubPRData | null> {
  const fromRaw = await getDerivedPrDataFromRawSnapshots(owner, repo, prNumber)
  if (fromRaw) return fromRaw
  return getLegacyPrData(owner, repo, prNumber, requiredLegacyTypes)
}

export async function getPrDataForDiff(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ metadata: PrMetadata; reviews: PrReview[]; commits: PrCommit[] } | null> {
  const prData = await getCachedPrData(owner, repo, prNumber, ['reviews', 'commits'])
  if (!prData) return null
  const { metadata, reviews, commits } = mapPrDataToVerificationTypes(prNumber, prData)
  return { metadata, reviews, commits }
}

export async function fetchMutablePrDataFromGitHub(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{
  githubRepoId: number
  reviews: RawPrReview[]
  issueComments: RawIssueComment[]
  reviewComments: RawReviewComment[]
  apiVersion: ApiVersionMetadata
}> {
  const result = await getMutablePrDataFromGitHub(owner, repo, prNumber)

  if (!result) {
    throw new Error(`Failed to fetch mutable PR data for PR #${prNumber} from ${owner}/${repo}`)
  }

  return result
}

export async function persistMutablePrSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId: number,
  data: Awaited<ReturnType<typeof fetchMutablePrDataFromGitHub>>,
): Promise<void> {
  await savePrRawSnapshotsBatch(owner, repo, prNumber, githubRepoId, data.apiVersion, [
    { dataType: 'reviews', data: data.reviews },
    { dataType: 'comments', data: data.issueComments },
    { dataType: 'review_comments', data: data.reviewComments },
  ])
}

/**
 * Refreshes reviews, issue comments and review comments for a merged PR.
 * GitHub still allows adding reviews and comments after a PR is merged, so these
 * are re-fetched. PR metadata (branches, SHAs, merge state) and commits are frozen
 * by GitHub once merged and are intentionally not re-fetched here.
 * Returns null if the repository was deleted and recreated under the same name
 * (current github_repo_id no longer matches the cached one), so the caller can
 * fall back to a full refetch instead of mixing data from two different repositories.
 */
export async function refreshMutablePrData(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GitHubPRData | null> {
  const rawSnapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber)
  const prSnapshot = rawSnapshots.get('pr')
  if (!prSnapshot) return null

  const fetched = await fetchMutablePrDataFromGitHub(owner, repo, prNumber)
  if (fetched.githubRepoId !== prSnapshot.githubRepoId) return null

  await persistMutablePrSnapshots(owner, repo, prNumber, fetched.githubRepoId, fetched)

  return getDerivedPrDataFromRawSnapshots(owner, repo, prNumber)
}

export async function refreshDisplayData(owner: string, repo: string, prNumber: number): Promise<GitHubPRData | null> {
  const rawSnapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber)
  const prSnapshot = rawSnapshots.get('pr')
  if (!prSnapshot) return null

  const fetched = await getDisplayDataFromGitHub(owner, repo, prNumber)
  if (!fetched || fetched.githubRepoId !== prSnapshot.githubRepoId) return null

  await savePrRawSnapshotsBatch(owner, repo, prNumber, fetched.githubRepoId, fetched.apiVersion, [
    { dataType: 'pr', data: fetched.pr },
    { dataType: 'comments', data: fetched.issueComments },
  ])

  return getDerivedPrDataFromRawSnapshots(owner, repo, prNumber)
}

export interface FetchOptions {
  forceRefresh?: boolean
  refreshDisplayData?: boolean
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
  derivedFromRaw: boolean
}> {
  const { prNumber, mismatchedBaseBranches, mismatchedPrNumbers } = await findPrForCommit(
    owner,
    repo,
    commitSha,
    baseBranch,
    { forceRefresh: options?.forceRefresh },
  )
  if (!prNumber) {
    return { deployedPr: null, mismatchedBaseBranches, mismatchedPrNumbers, derivedFromRaw: false }
  }

  if (options?.refreshDisplayData) {
    const refreshed = await refreshDisplayData(owner, repo, prNumber)
    if (refreshed) {
      const mapped = mapPrDataToVerificationTypes(prNumber, refreshed)
      return {
        deployedPr: {
          number: prNumber,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          metadata: mapped.metadata,
          reviews: mapped.reviews,
          commits: mapped.commits,
        },
        mismatchedBaseBranches,
        mismatchedPrNumbers,
        derivedFromRaw: false,
      }
    }
  }

  if (!options?.forceRefresh) {
    const fromRaw = await getDerivedPrDataFromRawSnapshots(owner, repo, prNumber)
    const cachedPrData =
      fromRaw ?? (await getLegacyPrData(owner, repo, prNumber, ['reviews', 'commits', 'checks', 'comments']))
    if (cachedPrData) {
      const mapped = mapPrDataToVerificationTypes(prNumber, cachedPrData)
      return {
        deployedPr: {
          number: prNumber,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          metadata: mapped.metadata,
          reviews: mapped.reviews,
          commits: mapped.commits,
        },
        mismatchedBaseBranches,
        mismatchedPrNumbers,
        derivedFromRaw: Boolean(fromRaw),
      }
    }
  }

  if (options?.forceRefresh) {
    const cachedPrData = await getDerivedPrDataFromRawSnapshots(owner, repo, prNumber)
    if (cachedPrData?.merged_at) {
      const refreshed = await refreshMutablePrData(owner, repo, prNumber)
      if (refreshed) {
        const mapped = mapPrDataToVerificationTypes(prNumber, refreshed)
        return {
          deployedPr: {
            number: prNumber,
            url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
            metadata: mapped.metadata,
            reviews: mapped.reviews,
            commits: mapped.commits,
          },
          mismatchedBaseBranches,
          mismatchedPrNumbers,
          derivedFromRaw: false,
        }
      }
    }
  }

  const fetched = await fetchPrFromGitHub(owner, repo, prNumber)
  const { metadata, reviews, commits } = fetched

  await persistPrSnapshots(owner, repo, prNumber, fetched)

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
    derivedFromRaw: false,
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

export function mapPrDataToVerificationTypes(
  prNumber: number,
  prData: GitHubPRData,
): {
  metadata: PrMetadata
  reviews: PrReview[]
  commits: PrCommit[]
  checks: PrChecks
  comments: PrComment[]
} {
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
  raw: RawPrSnapshotData
  githubRepoId: number
  apiVersion: ApiVersionMetadata
}> {
  const result = await getDetailedPullRequestInfo(owner, repo, prNumber)

  if (!result) {
    throw new Error(`Failed to fetch PR #${prNumber} from ${owner}/${repo}`)
  }

  const { prData, raw, githubRepoId, apiVersion } = result
  const mapped = mapPrDataToVerificationTypes(prNumber, prData)

  return { ...mapped, raw, githubRepoId, apiVersion }
}

export async function persistPrSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
  data: Awaited<ReturnType<typeof fetchPrFromGitHub>>,
): Promise<void> {
  await savePrRawSnapshotsBatch(owner, repo, prNumber, data.githubRepoId, data.apiVersion, [
    { dataType: 'pr', data: data.raw.pr },
    { dataType: 'reviews', data: data.raw.reviews },
    { dataType: 'commits', data: data.raw.commits },
    { dataType: 'comments', data: data.raw.issueComments },
    { dataType: 'review_comments', data: data.raw.reviewComments },
  ])
}
