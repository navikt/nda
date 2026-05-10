/**
 * Fetch Verification Data
 *
 * This module handles fetching all data needed for verification.
 * Flow: GitHub API → Database → VerificationInput
 *
 * Key features:
 * - Checks database for cached data first
 * - Fetches from GitHub only if needed (outdated schema or forced refresh)
 * - Stores all fetched data to database before returning
 * - Handles GitHub retention (404/410) gracefully
 */

import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import {
  getAllLatestPrSnapshots,
  getLatestCommitSnapshot,
  getLatestCompareSnapshot,
  markPrDataUnavailable,
  saveCommitSnapshot,
  saveCompareSnapshot,
  savePrSnapshotsBatch,
} from '~/db/github-data.server'
import { heartbeatSyncJob, isSyncJobCancelled, logSyncJobMessage, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { APPROVED_STATUSES_SQL, LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { getCommitsBetween, getDetailedPullRequestInfo, getPullRequestForCommit, isCommitOnBranch } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import type { RepositoryStatus } from './types'
import {
  type CompareData,
  CURRENT_SCHEMA_VERSION,
  type ImplicitApprovalSettings,
  type PrChecks,
  type PrComment,
  type PrCommit,
  type PrMetadata,
  type PrReview,
  type VerificationInput,
} from './types'

// =============================================================================
// Main Fetch Function
// =============================================================================

interface FetchOptions {
  forceRefresh?: boolean
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
}

/**
 * Fetch all data needed for verifying a deployment.
 * Always stores data to database before returning.
 */
export async function fetchVerificationData(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  baseBranch: string,
  monitoredAppId: number,
  options?: FetchOptions,
): Promise<VerificationInput> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}`)
  }

  // Get app settings
  const appSettings = await getAppSettings(monitoredAppId)

  // Check repository status
  const repoCheck = await findRepositoryForApp(monitoredAppId, owner, repo)
  const repositoryStatus: RepositoryStatus = repoCheck.repository
    ? (repoCheck.repository.status as RepositoryStatus)
    : 'unknown'

  // Check if deployed commit is on the base branch
  const commitOnBaseBranch = await isCommitOnBranch(owner, repo, commitSha, baseBranch)

  // Get previous deployment (with group fallback)
  const previousDeployment = await getPreviousDeployment(
    deploymentId,
    owner,
    repo,
    environmentName,
    appSettings.auditStartYear,
    monitoredAppId,
  )

  // Get deployed commit's PR
  const deployedPrResult = await fetchDeployedPrData(owner, repo, commitSha, baseBranch, options)
  const deployedPr = deployedPrResult.deployedPr

  // Track branch mismatches for the deployed PR. We ONLY aggregate mismatch
  // when no PR was found on the configured baseBranch — having a matching PR
  // means the data is valid for verification, even if other associated PRs
  // exist (e.g. cherry-picks or backports to release branches).
  const mismatchedSet = new Map<string, Set<number>>()
  if (deployedPr === null) {
    for (let i = 0; i < deployedPrResult.mismatchedBaseBranches.length; i++) {
      const branch = deployedPrResult.mismatchedBaseBranches[i]
      const prNumber = deployedPrResult.mismatchedPrNumbers[i]
      if (!mismatchedSet.has(branch)) mismatchedSet.set(branch, new Set())
      mismatchedSet.get(branch)?.add(prNumber)
    }
  }

  // Get commits between deployments
  let commitsBetween: VerificationInput['commitsBetween'] = []
  let compareFailed = false
  if (previousDeployment) {
    const result = await fetchCommitsBetween(
      owner,
      repo,
      previousDeployment.commitSha,
      commitSha,
      baseBranch,
      previousDeployment.createdAt,
      options,
    )
    if (result === null) {
      compareFailed = true
    } else {
      commitsBetween = result
    }
  }

  // Aggregate base-branch mismatches discovered during commitsBetween enrichment.
  // Only aggregate for commits where NO matching PR was found on baseBranch —
  // a present `commit.pr` means we have valid data for the configured branch.
  for (const commit of commitsBetween) {
    if (commit.pr) continue
    if (commit.mismatchedBaseBranches) {
      for (let i = 0; i < commit.mismatchedBaseBranches.length; i++) {
        const branch = commit.mismatchedBaseBranches[i]
        const prNumber = commit.mismatchedPrNumbers?.[i]
        if (prNumber == null) continue
        if (!mismatchedSet.has(branch)) mismatchedSet.set(branch, new Set())
        mismatchedSet.get(branch)?.add(prNumber)
      }
    }
  }

  let branchMismatch: VerificationInput['branchMismatch']
  if (mismatchedSet.size > 0) {
    const detectedBranches = Array.from(mismatchedSet.keys())
    const prNumbers = Array.from(new Set(Array.from(mismatchedSet.values()).flatMap((s) => Array.from(s)))).sort(
      (a, b) => a - b,
    )
    branchMismatch = {
      expectedBranch: baseBranch,
      detectedBranches,
      prNumbers,
    }
  }

  // Check for nearby approved deploy with same commit when compare returns 0 commits
  // between different SHAs (possible transient GitHub API failure during rapid deploys)
  let nearbyApprovedDeployWithSameCommit: VerificationInput['nearbyApprovedDeployWithSameCommit']
  if (
    previousDeployment &&
    commitsBetween.length === 0 &&
    !compareFailed &&
    commitSha !== previousDeployment.commitSha
  ) {
    const nearbyResult = await pool.query(
      `SELECT d.id, d.four_eyes_status
       FROM deployments d
       WHERE d.monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
         AND d.id != $1
         AND d.commit_sha = $2
         AND d.four_eyes_status IN (${APPROVED_STATUSES_SQL})
         AND d.created_at BETWEEN (
           (SELECT created_at FROM deployments WHERE id = $1) - interval '30 minutes'
         ) AND (
           (SELECT created_at FROM deployments WHERE id = $1) + interval '30 minutes'
         )
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [deploymentId, commitSha],
    )
    if (nearbyResult.rows.length > 0) {
      nearbyApprovedDeployWithSameCommit = {
        deploymentId: nearbyResult.rows[0].id,
        status: nearbyResult.rows[0].four_eyes_status,
      }
    }
  }

  // Broader fallback: find ANY nearby approved deploy (regardless of commit SHA).
  // When compare returns 0 commits between different SHAs and no same-commit sibling exists,
  // this deploy's commit is likely an ancestor of a nearby approved deploy (superseded deploy).
  let nearbyApprovedDeploy: VerificationInput['nearbyApprovedDeploy']
  if (
    previousDeployment &&
    commitsBetween.length === 0 &&
    !compareFailed &&
    commitSha !== previousDeployment.commitSha &&
    !nearbyApprovedDeployWithSameCommit
  ) {
    const nearbyAnyResult = await pool.query(
      `SELECT d.id, d.commit_sha, d.four_eyes_status
       FROM deployments d
       WHERE d.monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
         AND d.id != $1
         AND d.four_eyes_status IN (${APPROVED_STATUSES_SQL})
         AND d.created_at BETWEEN (
           (SELECT created_at FROM deployments WHERE id = $1) - interval '30 minutes'
         ) AND (
           (SELECT created_at FROM deployments WHERE id = $1) + interval '30 minutes'
         )
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [deploymentId],
    )
    if (nearbyAnyResult.rows.length > 0) {
      nearbyApprovedDeploy = {
        deploymentId: nearbyAnyResult.rows[0].id,
        commitSha: nearbyAnyResult.rows[0].commit_sha,
        status: nearbyAnyResult.rows[0].four_eyes_status,
      }
    }
  }

  return {
    deploymentId,
    commitSha,
    repository,
    environmentName,
    baseBranch,
    repositoryStatus,
    commitOnBaseBranch,
    auditStartYear: appSettings.auditStartYear,
    implicitApprovalSettings: appSettings.implicitApprovalSettings,
    previousDeployment,
    deployedPr,
    commitsBetween,
    compareFailed,
    nearbyApprovedDeployWithSameCommit,
    nearbyApprovedDeploy,
    branchMismatch,
    dataFreshness: {
      deployedPrFetchedAt: deployedPr ? new Date() : null,
      commitsFetchedAt: commitsBetween.length > 0 ? new Date() : null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
  }
}

// =============================================================================
// App Settings
// =============================================================================

async function getAppSettings(monitoredAppId: number): Promise<{
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings
}> {
  // Get audit_start_year from monitored_applications
  const appResult = await pool.query(`SELECT audit_start_year FROM monitored_applications WHERE id = $1`, [
    monitoredAppId,
  ])

  if (appResult.rows.length === 0) {
    return {
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
    }
  }

  // Get implicit approval settings from app_settings
  const settingsResult = await pool.query(
    `SELECT setting_value FROM app_settings 
     WHERE monitored_app_id = $1 AND setting_key = 'implicit_approval'`,
    [monitoredAppId],
  )

  let implicitApprovalSettings: ImplicitApprovalSettings = { mode: 'off' }
  if (settingsResult.rows.length > 0 && settingsResult.rows[0].setting_value) {
    const settingValue = settingsResult.rows[0].setting_value
    if (settingValue.mode === 'dependabot_only' || settingValue.mode === 'all') {
      implicitApprovalSettings = { mode: settingValue.mode }
    }
  }

  return {
    auditStartYear: appResult.rows[0].audit_start_year,
    implicitApprovalSettings,
  }
}

// =============================================================================
// Previous Deployment
// =============================================================================

async function getPreviousDeployment(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  environmentName: string,
  auditStartYear: number | null,
  monitoredAppId: number,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
  // VIKTIG: Bruk created_at for å finne forrige deployment, IKKE id.
  // Deployment-IDer korrelerer ikke med kronologisk rekkefølge fordi
  // deployments kan legges til systemet i vilkårlig rekkefølge.
  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
      AND ma.environment_name = $2
      AND d.detected_github_owner = $3
      AND d.detected_github_repo_name = $4
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
  `
  const params: (number | string)[] = [currentDeploymentId, environmentName, owner, repo]

  if (auditStartYear) {
    query += ` AND d.created_at >= $5`
    params.push(`${auditStartYear}-01-01`)
  }

  query += ` ORDER BY d.created_at DESC LIMIT 1`

  const result = await pool.query(query, params)

  if (result.rows.length > 0) {
    return {
      id: result.rows[0].id,
      commitSha: result.rows[0].commit_sha,
      createdAt: result.rows[0].created_at.toISOString(),
    }
  }

  // Fallback: look for a previous deployment from the same repo in a sibling
  // environment within the same application group. This avoids unnecessary
  // pending_baseline when a new environment variant is added to an existing group.
  return getPreviousDeploymentFromGroupSibling(currentDeploymentId, owner, repo, auditStartYear, monitoredAppId)
}

/**
 * Fallback for `getPreviousDeployment`: when no prior deployment exists in the
 * same environment, look across sibling apps in the same application group.
 * Returns null immediately when the app has no group (avoids unnecessary query).
 */
async function getPreviousDeploymentFromGroupSibling(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  auditStartYear: number | null,
  monitoredAppId: number,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
  // Early return: check if app belongs to a group
  const groupCheck = await pool.query<{ application_group_id: number | null }>(
    `SELECT application_group_id FROM monitored_applications WHERE id = $1`,
    [monitoredAppId],
  )
  const groupId = groupCheck.rows[0]?.application_group_id
  if (!groupId) return null

  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
      AND d.detected_github_owner = $2
      AND d.detected_github_repo_name = $3
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
      AND ma.application_group_id = $4
  `
  const params: (number | string)[] = [currentDeploymentId, owner, repo, groupId]

  if (auditStartYear) {
    query += ` AND d.created_at >= $5`
    params.push(`${auditStartYear}-01-01`)
  }

  query += ` ORDER BY d.created_at DESC LIMIT 1`

  const result = await pool.query(query, params)

  if (result.rows.length === 0) {
    return null
  }

  return {
    id: result.rows[0].id,
    commitSha: result.rows[0].commit_sha,
    createdAt: result.rows[0].created_at.toISOString(),
  }
}

// =============================================================================
// PR Data Fetching
// =============================================================================

async function fetchDeployedPrData(
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
  // First, find PR number for this commit
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

  // Check if we have cached data
  if (!options?.forceRefresh) {
    const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

    if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
      const metadata = cachedData.get('metadata')?.data as PrMetadata
      const reviews = cachedData.get('reviews')?.data as PrReview[]
      const commits = cachedData.get('commits')?.data as PrCommit[]

      // If checks/comments are missing (schema v1 data), fetch fresh data
      if (!cachedData.has('checks') || !cachedData.has('comments')) {
        // Fall through to GitHub fetch to get complete data
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

  // Fetch from GitHub
  const { metadata, reviews, commits, checks, comments } = await fetchPrFromGitHub(owner, repo, prNumber)

  // Store to database
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

/**
 * Find the PR number for a commit and detect any base-branch mismatches.
 *
 * Returns:
 *  - prNumber: the PR number matching `baseBranch` (or any associated PR if
 *    baseBranch is not specified). null if no matching PR.
 *  - mismatchedBaseBranches: the actual base branches of PRs associated with
 *    this commit but NOT matching `baseBranch`. Used to surface a warning
 *    when, e.g., the configured `default_branch` doesn't match the actual
 *    repo default branch.
 *  - mismatchedPrNumbers: the PR numbers of those mismatched PRs (parallel to
 *    mismatchedBaseBranches by index).
 *
 * Cache shape (schema v3+) stores all associated PRs with their actual base
 * branches. Schema v2 stored only the requested base branch and is treated as
 * unusable for mismatch detection — refetched on demand.
 */
async function findPrForCommit(
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

  // When forceRefresh is true, skip cache entirely to handle stale empty
  // PR associations (e.g. cached `{ prs: [] }` from a race condition where
  // GitHub hadn't indexed the merge commit yet).
  if (!forceRefresh) {
    // First check our cached PR associations
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
      // Cache hit but no match for this baseBranch
      if (cacheOnly || prs.length === 0) {
        return {
          prNumber: null,
          mismatchedBaseBranches: mismatchedPrs.map((p) => p.baseBranch),
          mismatchedPrNumbers: mismatchedPrs.map((p) => p.number),
        }
      }
      // Fall through to GitHub when cache says "associated PRs exist but none on baseBranch"
      // — we still want to refresh in case the PR was retargeted.
    }
  }

  // In cache-only mode, don't fetch from GitHub
  if (cacheOnly) {
    return { prNumber: null, mismatchedBaseBranches: [], mismatchedPrNumbers: [] }
  }

  // Fetch from GitHub API
  const { pr, allAssociatedPrs } = await getPullRequestForCommit(owner, repo, commitSha, true, baseBranch)

  // Persist all associated PRs with their actual base branches (schema v3 shape)
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
}> {
  const prData = await getDetailedPullRequestInfo(owner, repo, prNumber)

  if (!prData) {
    throw new Error(`Failed to fetch PR #${prNumber} from ${owner}/${repo}`)
  }

  // Transform to our schema types
  const metadata: PrMetadata = {
    number: prNumber,
    title: prData.title,
    body: prData.body || null,
    state: prData.merged_at ? 'closed' : 'open',
    merged: !!prData.merged_at,
    draft: prData.draft,
    createdAt: prData.created_at,
    updatedAt: prData.created_at, // Not available in getDetailedPullRequestInfo
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
    // Extended fields (schema version 2+)
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
    id: index + 1, // GitHub doesn't provide review ID in this response
    username: r.username,
    state: r.state as 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED',
    submittedAt: r.submitted_at,
    body: null,
  }))

  const commits: PrCommit[] = prData.commits.map((c) => ({
    sha: c.sha,
    message: c.message,
    authorUsername: c.author.username,
    authorDate: c.date,
    committerDate: c.date,
    isMergeCommit: false,
    parentShas: [],
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

// =============================================================================
// Commits Between Deployments
// =============================================================================

async function fetchCommitsBetween(
  owner: string,
  repo: string,
  fromSha: string,
  toSha: string,
  baseBranch: string,
  _previousDeploymentDate: string,
  options?: FetchOptions,
): Promise<VerificationInput['commitsBetween'] | null> {
  // Check cache first
  if (!options?.forceRefresh) {
    const cachedCompare = await getLatestCompareSnapshot(owner, repo, fromSha, toSha)
    if (cachedCompare) {
      logger.info(`   📦 Using cached compare data (${cachedCompare.data.commits.length} commits)`)
      return buildCommitsBetweenFromCache(owner, repo, baseBranch, cachedCompare.data, options)
    }
  }

  // Fetch from GitHub API
  logger.info(`   🌐 Fetching compare from GitHub: ${fromSha.substring(0, 7)}...${toSha.substring(0, 7)}`)
  const commitsRaw = await getCommitsBetween(owner, repo, fromSha, toSha)

  if (!commitsRaw) {
    logger.warn(`Could not fetch commits between ${fromSha} and ${toSha}`)
    return null
  }

  // Build compare data for storage
  const compareData: CompareData = {
    commits: commitsRaw.map((commit) => ({
      sha: commit.sha,
      message: commit.message,
      authorUsername: commit.author,
      authorDate: commit.date,
      committerDate: commit.committer_date,
      parentShas: commit.parent_shas,
      isMergeCommit: commit.parents_count > 1,
      htmlUrl: commit.html_url,
    })),
  }

  // Save compare snapshot to database
  await saveCompareSnapshot(owner, repo, fromSha, toSha, compareData)

  // Also store individual commit snapshots
  for (const commit of compareData.commits) {
    await saveCommitSnapshot(owner, repo, commit.sha, 'metadata', commit)
  }

  // Build the result with PR data
  return buildCommitsBetweenFromCache(owner, repo, baseBranch, compareData, options)
}

/**
 * Build commitsBetween result from cached compare data.
 * If cacheOnly is true, only uses cached data (no GitHub API calls).
 */
export async function buildCommitsBetweenFromCache(
  owner: string,
  repo: string,
  baseBranch: string,
  compareData: CompareData,
  options?: FetchOptions & { cacheOnly?: boolean },
): Promise<VerificationInput['commitsBetween']> {
  const result: VerificationInput['commitsBetween'] = []
  const cacheOnly = options?.cacheOnly ?? false

  for (const commit of compareData.commits) {
    const { prNumber, mismatchedBaseBranches, mismatchedPrNumbers } = await findPrForCommit(
      owner,
      repo,
      commit.sha,
      baseBranch,
      { cacheOnly, forceRefresh: options?.forceRefresh },
    )

    let prData: VerificationInput['commitsBetween'][0]['pr'] = null

    if (prNumber && !options?.forceRefresh) {
      // Try to get PR data from cache first
      const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

      if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
        const metadata = cachedData.get('metadata')?.data as PrMetadata
        const reviews = cachedData.get('reviews')?.data as PrReview[]
        const prCommits = cachedData.get('commits')?.data as PrCommit[]

        prData = {
          number: prNumber,
          title: metadata.title,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          reviews,
          commits: prCommits,
          baseBranch: metadata.baseBranch,
        }
      }
    }

    if (prNumber && !prData && !cacheOnly) {
      // Fetch from GitHub (only if not cache-only mode)
      try {
        const {
          metadata,
          reviews,
          commits: prCommits,
          checks,
          comments,
        } = await fetchPrFromGitHub(owner, repo, prNumber)

        // Store to database
        await savePrSnapshotsBatch(owner, repo, prNumber, [
          { dataType: 'metadata', data: metadata },
          { dataType: 'reviews', data: reviews },
          { dataType: 'commits', data: prCommits },
          { dataType: 'checks', data: checks },
          { dataType: 'comments', data: comments },
        ])

        prData = {
          number: prNumber,
          title: metadata.title,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          reviews,
          commits: prCommits,
          baseBranch: metadata.baseBranch,
        }
      } catch (error) {
        logger.warn(`Failed to fetch PR #${prNumber} for commit ${commit.sha}: ${error}`)
      }
    }

    result.push({
      sha: commit.sha,
      message: commit.message,
      authorUsername: commit.authorUsername,
      authorDate: commit.authorDate,
      isMergeCommit: commit.isMergeCommit,
      parentShas: commit.parentShas,
      htmlUrl: commit.htmlUrl,
      pr: prData,
      mismatchedBaseBranches: mismatchedBaseBranches.length > 0 ? mismatchedBaseBranches : undefined,
      mismatchedPrNumbers: mismatchedPrNumbers.length > 0 ? mismatchedPrNumbers : undefined,
    })
  }

  return result
}

// =============================================================================
// GitHub API Integration (to be connected)
// =============================================================================

/**
 * These functions will be connected to the existing github.server.ts module.
 * They handle the actual GitHub API calls and error handling.
 */

async function _refreshPrData(
  owner: string,
  repo: string,
  prNumber: number,
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[],
): Promise<void> {
  const typesToFetch = dataTypes ?? ['metadata', 'reviews', 'commits', 'checks', 'comments']

  try {
    // Fetch from GitHub
    const { metadata, reviews, commits, checks, comments } = await fetchPrFromGitHub(owner, repo, prNumber)

    // Store to database
    const snapshots: Array<{ dataType: 'metadata' | 'reviews' | 'commits' | 'checks' | 'comments'; data: unknown }> = []

    if (typesToFetch.includes('metadata')) {
      snapshots.push({ dataType: 'metadata', data: metadata })
    }
    if (typesToFetch.includes('reviews')) {
      snapshots.push({ dataType: 'reviews', data: reviews })
    }
    if (typesToFetch.includes('commits')) {
      snapshots.push({ dataType: 'commits', data: commits })
    }
    if (typesToFetch.includes('checks')) {
      snapshots.push({ dataType: 'checks', data: checks })
    }
    if (typesToFetch.includes('comments')) {
      snapshots.push({ dataType: 'comments', data: comments })
    }

    await savePrSnapshotsBatch(owner, repo, prNumber, snapshots)
  } catch (error) {
    // Handle GitHub 404/410 - data no longer available
    if (
      error instanceof Error &&
      'status' in error &&
      ((error as { status: number }).status === 404 || (error as { status: number }).status === 410)
    ) {
      for (const dataType of typesToFetch) {
        await markPrDataUnavailable(owner, repo, prNumber, dataType)
      }
    }
    throw error
  }
}

// =============================================================================
// Bulk Data Fetching for All Deployments
// =============================================================================

interface BulkFetchProgress {
  total: number
  processed: number
  skipped: number
  fetched: number
  errors: number
}

interface BulkFetchResult extends BulkFetchProgress {
  errorDetails: Array<{ deploymentId: number; error: string }>
}

/**
 * Fetch verification data for all deployments of an app.
 * Only fetches if schema version is outdated or no data exists.
 *
 * @param monitoredAppId - The app to fetch data for
 * @param options - Optional job tracking options (jobId for progress/cancel/heartbeat/logging)
 * @param onProgress - Optional callback for progress updates
 * @returns Summary of the fetch operation
 */
export async function fetchVerificationDataForAllDeployments(
  monitoredAppId: number,
  options?: { jobId?: number },
  onProgress?: (progress: BulkFetchProgress) => void,
): Promise<BulkFetchResult> {
  const jobId = options?.jobId

  // Get app settings first to know the audit start year
  const settingsStart = performance.now()
  const appSettings = await getAppSettings(monitoredAppId)
  logger.debug('Hentet app-innstillinger', {
    auditStartYear: appSettings.auditStartYear,
    durationMs: Math.round(performance.now() - settingsStart),
  })

  // Build query that pre-computes which deployments already have data,
  // avoiding N individual hasCurrentSchemaData calls (2-3 queries each).
  // Uses window function LAG() to find previous deployment's commit_sha,
  // then LEFT JOINs to check for existing PR and compare snapshots.
  let query = `
    WITH ordered_deployments AS (
      SELECT d.id, d.commit_sha, d.detected_github_owner, d.detected_github_repo_name,
             d.environment_name, ma.default_branch, d.created_at,
             LAG(d.commit_sha) OVER (
               PARTITION BY d.environment_name, d.detected_github_owner, d.detected_github_repo_name
               ORDER BY d.created_at ASC
             ) AS prev_commit_sha
      FROM deployments d
      JOIN monitored_applications ma ON d.monitored_app_id = ma.id
      WHERE d.monitored_app_id = $1
        AND d.commit_sha IS NOT NULL
        AND d.detected_github_owner IS NOT NULL
        AND d.detected_github_repo_name IS NOT NULL
        AND ${VALID_COMMIT_SHA_SQL}`

  const params: (number | string)[] = [monitoredAppId]

  if (appSettings.auditStartYear) {
    query += ` AND d.created_at >= $2`
    params.push(`${appSettings.auditStartYear}-01-01`)
  }

  query += `
    )
    SELECT od.*,
           (pr_snap.id IS NOT NULL) AS has_pr_snapshot,
           (od.prev_commit_sha IS NULL OR cmp_snap.id IS NOT NULL) AS has_compare_snapshot
    FROM ordered_deployments od
    LEFT JOIN LATERAL (
      SELECT id FROM github_commit_snapshots gcs
      WHERE gcs.owner = od.detected_github_owner
        AND gcs.repo = od.detected_github_repo_name
        AND gcs.sha = od.commit_sha
        AND gcs.data_type = 'prs'
        AND gcs.schema_version = ${CURRENT_SCHEMA_VERSION}
      ORDER BY gcs.fetched_at DESC LIMIT 1
    ) pr_snap ON true
    LEFT JOIN LATERAL (
      SELECT id FROM github_compare_snapshots gcs
      WHERE gcs.owner = od.detected_github_owner
        AND gcs.repo = od.detected_github_repo_name
        AND gcs.base_sha = od.prev_commit_sha
        AND gcs.head_sha = od.commit_sha
        AND gcs.schema_version = ${CURRENT_SCHEMA_VERSION}
      ORDER BY gcs.fetched_at DESC LIMIT 1
    ) cmp_snap ON od.prev_commit_sha IS NOT NULL
    ORDER BY od.created_at DESC`

  const queryStart = performance.now()
  const deploymentsResult = await pool.query(query, params)

  const deployments = deploymentsResult.rows
  logger.debug(`Fant ${deployments.length} deployments å sjekke`, {
    durationMs: Math.round(performance.now() - queryStart),
  })
  const result: BulkFetchResult = {
    total: deployments.length,
    processed: 0,
    skipped: 0,
    fetched: 0,
    errors: 0,
    errorDetails: [],
  }

  if (jobId) {
    await logSyncJobMessage(jobId, 'info', `Starter datahenting for ${deployments.length} deployments`)
    await updateSyncJobProgress(jobId, result)
  }

  for (const deployment of deployments) {
    // Check for cancellation
    if (jobId && (await isSyncJobCancelled(jobId))) {
      await logSyncJobMessage(jobId, 'info', `Jobb avbrutt etter ${result.processed} av ${result.total} deployments`)
      break
    }

    try {
      const owner = deployment.detected_github_owner
      const repo = deployment.detected_github_repo_name
      const commitSha = deployment.commit_sha
      const baseBranch = deployment.default_branch || 'main'

      // Use pre-computed snapshot existence from the query
      const hasCurrentData = deployment.has_pr_snapshot && deployment.has_compare_snapshot

      if (hasCurrentData) {
        result.skipped++
        logger.debug(`Hoppet over deployment ${deployment.id} (data finnes)`, {
          commitSha: commitSha.substring(0, 7),
          repo: `${owner}/${repo}`,
        })
      } else {
        // Fetch data (this will store to database)
        const fetchStart = performance.now()
        await fetchVerificationData(
          deployment.id,
          commitSha,
          `${owner}/${repo}`,
          deployment.environment_name,
          baseBranch,
          monitoredAppId,
          { forceRefresh: false }, // Only fetch what's missing
        )
        const fetchDuration = Math.round(performance.now() - fetchStart)
        result.fetched++
        if (jobId) {
          await logSyncJobMessage(jobId, 'info', `Hentet data for deployment ${deployment.id}`, {
            commitSha: commitSha.substring(0, 7),
            repo: `${owner}/${repo}`,
          })
        }
        logger.debug(`Hentet data for deployment ${deployment.id}`, {
          commitSha: commitSha.substring(0, 7),
          repo: `${owner}/${repo}`,
          fetchMs: fetchDuration,
        })
      }

      result.processed++
      onProgress?.(result)

      // Update progress and heartbeat
      if (jobId) {
        await updateSyncJobProgress(jobId, result)
        await heartbeatSyncJob(jobId)
      }
    } catch (error) {
      result.errors++
      result.processed++
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.errorDetails.push({
        deploymentId: deployment.id,
        error: errorMessage,
      })
      onProgress?.(result)

      if (jobId) {
        await logSyncJobMessage(jobId, 'error', `Feil for deployment ${deployment.id}`, {
          deploymentId: deployment.id,
          error: errorMessage,
        })
        await updateSyncJobProgress(jobId, result)
      }
    }
  }

  if (jobId) {
    await logSyncJobMessage(
      jobId,
      'info',
      `Datahenting fullført: ${result.fetched} hentet, ${result.skipped} hoppet over, ${result.errors} feil`,
    )
  }

  return result
}
