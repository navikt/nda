import type { GitHubPRData } from '~/db/deployments.server'
import {
  getAllLatestPrRawSnapshots,
  getAllLatestPrSnapshots,
  getLatestCommitAssociatedPrsRawSnapshot,
  getLatestCommitSnapshot,
  saveCommitSnapshot,
  savePrRawSnapshotsBatch,
} from '~/db/github-data.server'
import type { RepositoryCodeDeliveryAssessmentPrSnapshotIds } from '~/db/repository-code-delivery-assessment-sync.server'
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

function derivePrDataFromRawSnapshots(
  rawSnapshots: Awaited<ReturnType<typeof getAllLatestPrRawSnapshots>>,
): GitHubPRData | null {
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

async function getDerivedPrDataFromRawSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId?: number | string,
): Promise<GitHubPRData | null> {
  const rawSnapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber, githubRepoId)
  return derivePrDataFromRawSnapshots(rawSnapshots)
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
  githubRepoId?: number | string,
): Promise<GitHubPRData | null> {
  const fromRaw = await getDerivedPrDataFromRawSnapshots(owner, repo, prNumber, githubRepoId)
  if (fromRaw) return fromRaw
  if (githubRepoId != null) return null
  return getLegacyPrData(owner, repo, prNumber, requiredLegacyTypes)
}

export async function getPrDataForDiff(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId?: number | string,
): Promise<{ metadata: PrMetadata; reviews: PrReview[]; commits: PrCommit[] } | null> {
  const prData = await getCachedPrData(owner, repo, prNumber, ['reviews', 'commits'], githubRepoId)
  if (!prData) return null
  const { metadata, reviews, commits } = mapPrDataToVerificationTypes(prNumber, prData)
  return { metadata, reviews, commits }
}

async function fetchMutablePrDataFromGitHub(
  owner: string,
  repo: string,
  prNumber: number,
  includeComments: boolean = true,
  includeReviews: boolean = true,
): Promise<{
  githubRepoId: number
  reviews: RawPrReview[] | null
  issueComments: RawIssueComment[] | null
  reviewComments: RawReviewComment[] | null
  apiVersion: ApiVersionMetadata
}> {
  const result = await getMutablePrDataFromGitHub(owner, repo, prNumber, includeComments, includeReviews)

  if (!result) {
    throw new Error(`Failed to fetch mutable PR data for PR #${prNumber} from ${owner}/${repo}`)
  }

  return result
}

async function persistMutablePrSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId: number,
  data: Awaited<ReturnType<typeof fetchMutablePrDataFromGitHub>>,
): Promise<void> {
  const snapshots: Array<{ dataType: 'reviews' | 'comments' | 'review_comments'; data: unknown }> = []
  if (data.reviews !== null) snapshots.push({ dataType: 'reviews', data: data.reviews })
  if (data.issueComments !== null) snapshots.push({ dataType: 'comments', data: data.issueComments })
  if (data.reviewComments !== null) snapshots.push({ dataType: 'review_comments', data: data.reviewComments })

  await savePrRawSnapshotsBatch(owner, repo, prNumber, githubRepoId, data.apiVersion, snapshots)
}

async function refreshMutablePrData(
  owner: string,
  repo: string,
  prNumber: number,
  includeComments: boolean = true,
  includeReviews: boolean = true,
  githubRepoId?: number | string,
): Promise<GitHubPRData | null> {
  const rawSnapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber, githubRepoId)
  const prSnapshot = rawSnapshots.get('pr')
  if (!prSnapshot) return null

  const fetched = await fetchMutablePrDataFromGitHub(owner, repo, prNumber, includeComments, includeReviews)
  if (fetched.githubRepoId !== prSnapshot.githubRepoId) return null

  await persistMutablePrSnapshots(owner, repo, prNumber, fetched.githubRepoId, fetched)

  return getDerivedPrDataFromRawSnapshots(owner, repo, prNumber, githubRepoId)
}

export async function refreshDisplayData(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId?: number | string,
): Promise<GitHubPRData | null> {
  const rawSnapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber, githubRepoId)
  const prSnapshot = rawSnapshots.get('pr')
  if (!prSnapshot) return null

  const fetched = await getDisplayDataFromGitHub(owner, repo, prNumber)
  if (!fetched || fetched.githubRepoId !== prSnapshot.githubRepoId) return null

  await savePrRawSnapshotsBatch(owner, repo, prNumber, fetched.githubRepoId, fetched.apiVersion, [
    { dataType: 'pr', data: fetched.pr },
    { dataType: 'comments', data: fetched.issueComments },
  ])

  return getDerivedPrDataFromRawSnapshots(owner, repo, prNumber, githubRepoId)
}

export interface FetchOptions {
  forceRefresh?: boolean
  refreshDisplayData?: boolean
  githubRepoId?: number | string
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
  includeComments?: boolean
  includeReviews?: boolean
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
    { forceRefresh: options?.forceRefresh, githubRepoId: options?.githubRepoId },
  )
  if (!prNumber) {
    return { deployedPr: null, mismatchedBaseBranches, mismatchedPrNumbers, derivedFromRaw: false }
  }

  if (options?.refreshDisplayData) {
    const refreshed = await refreshDisplayData(owner, repo, prNumber, options?.githubRepoId)
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
    const fromRaw = await getDerivedPrDataFromRawSnapshots(owner, repo, prNumber, options?.githubRepoId)
    const cachedPrData =
      fromRaw ??
      (options?.githubRepoId == null
        ? await getLegacyPrData(owner, repo, prNumber, ['reviews', 'commits', 'checks', 'comments'])
        : null)
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

  const { metadata, reviews, commits } = await fetchOrRefreshMergedPrData(
    owner,
    repo,
    prNumber,
    options?.forceRefresh ?? false,
    options?.includeComments ?? true,
    options?.includeReviews ?? true,
    options?.githubRepoId,
  )

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

export async function fetchOrRefreshMergedPrData(
  owner: string,
  repo: string,
  prNumber: number,
  forceRefresh: boolean,
  includeComments: boolean = true,
  includeReviews: boolean = true,
  githubRepoId?: number | string,
): Promise<{ metadata: PrMetadata; reviews: PrReview[]; commits: PrCommit[] }> {
  if (forceRefresh) {
    const cachedPrData = await getDerivedPrDataFromRawSnapshots(owner, repo, prNumber, githubRepoId)
    if (cachedPrData?.merged_at) {
      const refreshed = await refreshMutablePrData(owner, repo, prNumber, includeComments, includeReviews, githubRepoId)
      if (refreshed) {
        return mapPrDataToVerificationTypes(prNumber, refreshed)
      }
    }
  }

  const fetched = await fetchPrFromGitHub(owner, repo, prNumber)
  await persistPrSnapshots(owner, repo, prNumber, fetched)
  return fetched
}

function isConsistentPrAssessmentData(pr: unknown, reviews: unknown, commits: unknown, prNumber: number): boolean {
  if (!pr || typeof pr !== 'object' || Array.isArray(pr) || !Array.isArray(reviews) || !Array.isArray(commits)) {
    return false
  }

  const metadata = pr as Record<string, unknown>
  const head = metadata.head
  if (
    metadata.number !== prNumber ||
    !Number.isSafeInteger(metadata.commits) ||
    metadata.commits !== commits.length ||
    !head ||
    typeof head !== 'object' ||
    Array.isArray(head) ||
    typeof (head as Record<string, unknown>).sha !== 'string'
  ) {
    return false
  }

  const lastCommit = commits[commits.length - 1]
  return (
    !!lastCommit &&
    typeof lastCommit === 'object' &&
    !Array.isArray(lastCommit) &&
    (lastCommit as Record<string, unknown>).sha === (head as Record<string, unknown>).sha
  )
}

export async function ensurePrReviewSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId: number,
  deliverySnapshotIds: RepositoryCodeDeliveryAssessmentPrSnapshotIds | undefined,
  beforeFetch: () => void,
): Promise<RepositoryCodeDeliveryAssessmentPrSnapshotIds> {
  const getConsistentRawSnapshotIds = async (): Promise<RepositoryCodeDeliveryAssessmentPrSnapshotIds | null> => {
    const snapshots = await getAllLatestPrRawSnapshots(owner, repo, prNumber)
    if (
      !(['pr', 'reviews', 'commits', 'comments', 'review_comments'] as const).every(
        (type) => snapshots.get(type)?.githubRepoId === githubRepoId,
      ) ||
      !isConsistentPrAssessmentData(
        snapshots.get('pr')?.data,
        snapshots.get('reviews')?.data,
        snapshots.get('commits')?.data,
        prNumber,
      ) ||
      derivePrDataFromRawSnapshots(snapshots) === null
    ) {
      return null
    }

    const pr = snapshots.get('pr')
    const reviews = snapshots.get('reviews')
    const commits = snapshots.get('commits')
    const comments = snapshots.get('comments')
    const reviewComments = snapshots.get('review_comments')
    if (!pr || !reviews || !commits || !comments || !reviewComments) return null
    return {
      pr: pr.id,
      reviews: reviews.id,
      commits: commits.id,
      comments: comments.id,
      reviewComments: reviewComments.id,
    }
  }

  const currentSnapshotIds = await getConsistentRawSnapshotIds()
  if (deliverySnapshotIds && currentSnapshotIds && isSamePrSnapshotIds(currentSnapshotIds, deliverySnapshotIds)) {
    return currentSnapshotIds
  }

  beforeFetch()
  const fetched = await getDetailedPullRequestInfo(owner, repo, prNumber)
  if (!fetched) throw new Error(`Failed to fetch fresh snapshots for PR #${prNumber} from ${owner}/${repo}`)
  if (fetched.githubRepoId !== githubRepoId) {
    throw new Error(`GitHub repository identity changed while loading PR #${prNumber}`)
  }

  const { pr, reviews, commits } = fetched.raw
  if (!isConsistentPrAssessmentData(pr, reviews, commits, prNumber)) {
    throw new Error(`Fresh PR #${prNumber} snapshots are inconsistent for ${owner}/${repo}`)
  }

  await savePrRawSnapshotsBatch(owner, repo, prNumber, fetched.githubRepoId, fetched.apiVersion, [
    { dataType: 'pr', data: pr },
    { dataType: 'reviews', data: reviews },
    { dataType: 'commits', data: commits },
    { dataType: 'comments', data: fetched.raw.issueComments },
    { dataType: 'review_comments', data: fetched.raw.reviewComments },
  ])

  const persistedSnapshotIds = await getConsistentRawSnapshotIds()
  if (!persistedSnapshotIds) {
    throw new Error(`Fresh PR #${prNumber} snapshots were not persisted for ${owner}/${repo}`)
  }
  return persistedSnapshotIds
}

function isSamePrSnapshotIds(
  left: RepositoryCodeDeliveryAssessmentPrSnapshotIds,
  right: RepositoryCodeDeliveryAssessmentPrSnapshotIds,
): boolean {
  return (
    left.pr === right.pr &&
    left.reviews === right.reviews &&
    left.commits === right.commits &&
    left.comments === right.comments &&
    left.reviewComments === right.reviewComments
  )
}

export async function findPrForCommit(
  owner: string,
  repo: string,
  commitSha: string,
  baseBranch?: string,
  options?: { cacheOnly?: boolean; forceRefresh?: boolean; githubRepoId?: number | string },
): Promise<{
  prNumber: number | null
  mismatchedBaseBranches: string[]
  mismatchedPrNumbers: number[]
}> {
  const cacheOnly = options?.cacheOnly ?? false
  const forceRefresh = options?.forceRefresh ?? false

  let cachedPrs: Array<{ number: number; baseBranch: string }> | null = null
  if (!forceRefresh && options?.githubRepoId != null) {
    const cached = await getLatestCommitAssociatedPrsRawSnapshot(owner, repo, commitSha, options.githubRepoId)
    if (cached?.paginationComplete && Array.isArray(cached.data)) {
      cachedPrs = cached.data.flatMap((entry: { number?: unknown; base?: { ref?: unknown } }) =>
        typeof entry.number === 'number' && typeof entry.base?.ref === 'string'
          ? [{ number: entry.number, baseBranch: entry.base.ref }]
          : [],
      )
    }
  } else if (!forceRefresh) {
    const cached = await getLatestCommitSnapshot(owner, repo, commitSha, 'prs')
    if (cached && cached.schemaVersion >= CURRENT_SCHEMA_VERSION) {
      cachedPrs = (cached.data as { prs: Array<{ number: number; baseBranch: string }> }).prs
    }
  }

  if (cachedPrs) {
    const matchingPrs = baseBranch ? cachedPrs.filter((pr) => pr.baseBranch === baseBranch) : cachedPrs
    const mismatchedPrs = baseBranch ? cachedPrs.filter((pr) => pr.baseBranch !== baseBranch) : []
    if (matchingPrs.length > 0) {
      return {
        prNumber: matchingPrs[0].number,
        mismatchedBaseBranches: mismatchedPrs.map((p) => p.baseBranch),
        mismatchedPrNumbers: mismatchedPrs.map((p) => p.number),
      }
    }
    if (cacheOnly || cachedPrs.length === 0) {
      return {
        prNumber: null,
        mismatchedBaseBranches: mismatchedPrs.map((p) => p.baseBranch),
        mismatchedPrNumbers: mismatchedPrs.map((p) => p.number),
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

async function fetchPrFromGitHub(
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

async function persistPrSnapshots(
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
