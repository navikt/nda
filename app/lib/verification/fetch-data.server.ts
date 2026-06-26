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
import {
  getBranchFromWorkflowRun,
  getCommitsBetween,
  getDetailedPullRequestInfo,
  getPullRequestForCommit,
  getSingleCommitMessage,
  haveSameCommitTree,
  isCommitOnBranch,
} from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { buildBranchMismatch } from './branch-mismatch'
import type { RepositoryStatus } from './types'
import {
  type CompareData,
  type CompareSummary,
  CURRENT_SCHEMA_VERSION,
  type ImplicitApprovalSettings,
  type PrChecks,
  type PrComment,
  type PrCommit,
  type PrMetadata,
  type PrReview,
  type VerificationInput,
} from './types'

interface FetchOptions {
  forceRefresh?: boolean
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
}

export async function fetchVerificationData(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  baseBranch: string,
  monitoredAppId: number,
  options?: FetchOptions,
  triggerUrl?: string | null,
): Promise<VerificationInput> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}`)
  }

  const appSettings = await getAppSettings(monitoredAppId)

  const repoCheck = await findRepositoryForApp(monitoredAppId, owner, repo)
  const repositoryStatus: RepositoryStatus = repoCheck.repository
    ? (repoCheck.repository.status as RepositoryStatus)
    : 'unknown'

  const commitOnBaseBranch = await isCommitOnBranch(owner, repo, commitSha, baseBranch)

  const previousDeployment = await getPreviousDeployment(
    deploymentId,
    owner,
    repo,
    environmentName,
    appSettings.auditStartYear,
    monitoredAppId,
  )

  const deployedPrResult = await fetchDeployedPrData(owner, repo, commitSha, baseBranch, options)
  const deployedPr = deployedPrResult.deployedPr

  let commitsBetween: VerificationInput['commitsBetween'] = []
  let compareSummary: CompareSummary | null = null
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
      commitsBetween = result.commitsBetween
      compareSummary = result.compareSummary
    }
  }
  const noDiffAlreadyConfirmed = compareSummary?.noDiffDetected === true

  const branchMismatch = buildBranchMismatch(
    deployedPr,
    deployedPrResult.mismatchedBaseBranches,
    deployedPrResult.mismatchedPrNumbers,
    commitsBetween,
    baseBranch,
  )

  let nearbyApprovedDeployWithSameCommit: VerificationInput['nearbyApprovedDeployWithSameCommit']
  if (
    previousDeployment &&
    commitsBetween.length === 0 &&
    !compareFailed &&
    commitSha !== previousDeployment.commitSha &&
    !noDiffAlreadyConfirmed
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

  let nearbyApprovedDeploy: VerificationInput['nearbyApprovedDeploy']
  if (
    previousDeployment &&
    commitsBetween.length === 0 &&
    !compareFailed &&
    commitSha !== previousDeployment.commitSha &&
    !noDiffAlreadyConfirmed &&
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

  const detectedBranchName: string | undefined =
    deployedPr?.metadata.headBranch ?? (await getBranchFromWorkflowRun(owner, repo, triggerUrl)) ?? undefined

  const rawFirstCommitMessage = await resolveRawCommitMessage({
    deployedPr,
    commitsBetween,
    previousDeployment,
    owner,
    repo,
    commitSha,
  })
  const detectedTitle: string | undefined = rawFirstCommitMessage
    ? rawFirstCommitMessage.split('\n')[0].trim().slice(0, 500) || undefined
    : undefined

  return {
    deploymentId,
    commitSha,
    repository,
    environmentName,
    baseBranch,
    repositoryStatus,
    commitOnBaseBranch,
    detectedBranchName: detectedBranchName ?? undefined,
    detectedTitle,
    auditStartYear: appSettings.auditStartYear,
    implicitApprovalSettings: appSettings.implicitApprovalSettings,
    previousDeployment,
    deployedPr,
    commitsBetween,
    compareFailed,
    compareSummary,
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

async function getAppSettings(monitoredAppId: number): Promise<{
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings
}> {
  const appResult = await pool.query(`SELECT audit_start_year FROM monitored_applications WHERE id = $1`, [
    monitoredAppId,
  ])

  if (appResult.rows.length === 0) {
    return {
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
    }
  }

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

async function getPreviousDeployment(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  environmentName: string,
  auditStartYear: number | null,
  monitoredAppId: number,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
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

  return getPreviousDeploymentFromGroupSibling(currentDeploymentId, owner, repo, auditStartYear, monitoredAppId)
}

async function getPreviousDeploymentFromGroupSibling(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  auditStartYear: number | null,
  monitoredAppId: number,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
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
      // Fall through to GitHub when associated PRs exist but none match
      // baseBranch (PR may have been retargeted).
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

export async function resolveRawCommitMessage({
  deployedPr,
  commitsBetween,
  previousDeployment,
  owner,
  repo,
  commitSha,
}: {
  deployedPr: VerificationInput['deployedPr']
  commitsBetween: VerificationInput['commitsBetween']
  previousDeployment: VerificationInput['previousDeployment']
  owner: string
  repo: string
  commitSha: string
}): Promise<string | undefined> {
  if (deployedPr) return undefined
  const fromBetween = commitsBetween[0]?.message
  if (fromBetween) return fromBetween
  if (!previousDeployment) {
    const commitMsg = await getSingleCommitMessage(owner, repo, commitSha)
    return commitMsg ?? undefined
  }
  return undefined
}

export function resolveNoDiffDetection(
  compareData: CompareData,
  fromSha: string,
  toSha: string,
  hasSameTree: boolean | null,
): { noDiffDetected: boolean; shouldPersistCompare: boolean } {
  const isEmptyCompare = compareData.commits.length === 0 && compareData.compare.changedFiles === 0
  const shouldTryTreeFallback = isEmptyCompare && compareData.compare.status !== 'identical' && fromSha !== toSha
  const noDiffDetected = isEmptyCompare && (compareData.compare.status === 'identical' || hasSameTree === true)
  const shouldPersistCompare = !shouldTryTreeFallback || hasSameTree !== null
  return { noDiffDetected, shouldPersistCompare }
}

async function fetchCommitsBetween(
  owner: string,
  repo: string,
  fromSha: string,
  toSha: string,
  baseBranch: string,
  _previousDeploymentDate: string,
  options?: FetchOptions,
): Promise<{ commitsBetween: VerificationInput['commitsBetween']; compareSummary: CompareSummary } | null> {
  if (!options?.forceRefresh) {
    const cachedCompare = await getLatestCompareSnapshot(owner, repo, fromSha, toSha)
    if (cachedCompare) {
      logger.info(
        `   📦 Using cached compare data (${cachedCompare.data.commits.length} commits, ${cachedCompare.data.compare.changedFiles} files)`,
      )
      return {
        commitsBetween: await buildCommitsBetweenFromCache(owner, repo, baseBranch, cachedCompare.data, options),
        compareSummary: cachedCompare.data.compare,
      }
    }
  }

  logger.info(`   🌐 Fetching compare from GitHub: ${fromSha.substring(0, 7)}...${toSha.substring(0, 7)}`)
  const compareData = await getCommitsBetween(owner, repo, fromSha, toSha)

  if (!compareData) {
    logger.warn(`Could not fetch commits between ${fromSha} and ${toSha}`)
    return null
  }

  const isEmptyCompare = compareData.commits.length === 0 && compareData.compare.changedFiles === 0
  const shouldTryTreeFallback = isEmptyCompare && compareData.compare.status !== 'identical' && fromSha !== toSha
  let hasSameTree: boolean | null = null
  if (shouldTryTreeFallback) {
    hasSameTree = await haveSameCommitTree(owner, repo, fromSha, toSha)
  }

  const { noDiffDetected, shouldPersistCompare } = resolveNoDiffDetection(compareData, fromSha, toSha, hasSameTree)

  const storedCompareData: CompareData = {
    ...compareData,
    compare: {
      ...compareData.compare,
      noDiffDetected,
    },
  }

  if (shouldPersistCompare) {
    await saveCompareSnapshot(owner, repo, fromSha, toSha, storedCompareData)
  } else {
    logger.warn(
      `Skipping compare snapshot cache for ${fromSha.substring(0, 7)}...${toSha.substring(0, 7)}: tree fallback inconclusive`,
    )
  }

  for (const commit of storedCompareData.commits) {
    await saveCommitSnapshot(owner, repo, commit.sha, 'metadata', commit)
  }

  return {
    commitsBetween: await buildCommitsBetweenFromCache(owner, repo, baseBranch, storedCompareData, options),
    compareSummary: storedCompareData.compare,
  }
}

const COMMIT_CONCURRENCY_LIMIT = 10

export async function buildCommitsBetweenFromCache(
  owner: string,
  repo: string,
  baseBranch: string,
  compareData: CompareData,
  options?: FetchOptions & { cacheOnly?: boolean },
): Promise<VerificationInput['commitsBetween']> {
  const cacheOnly = options?.cacheOnly ?? false
  const prFetchCache = new Map<number, Promise<Awaited<ReturnType<typeof fetchPrFromGitHub>>>>()

  const processCommit = async (commit: CompareData['commits'][0]) => {
    const { prNumber, mismatchedBaseBranches, mismatchedPrNumbers } = await findPrForCommit(
      owner,
      repo,
      commit.sha,
      baseBranch,
      { cacheOnly, forceRefresh: options?.forceRefresh },
    )

    let prData: VerificationInput['commitsBetween'][0]['pr'] = null

    if (prNumber && !options?.forceRefresh) {
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
      let prFetch = prFetchCache.get(prNumber)
      if (!prFetch) {
        prFetch = fetchPrFromGitHub(owner, repo, prNumber)
          .then(async (data) => {
            await savePrSnapshotsBatch(owner, repo, prNumber, [
              { dataType: 'metadata', data: data.metadata },
              { dataType: 'reviews', data: data.reviews },
              { dataType: 'commits', data: data.commits },
              { dataType: 'checks', data: data.checks },
              { dataType: 'comments', data: data.comments },
            ])
            return data
          })
          .catch((error) => {
            prFetchCache.delete(prNumber)
            throw error
          })
        prFetchCache.set(prNumber, prFetch)
      }
      try {
        const { metadata, reviews, commits: prCommits } = await prFetch
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

    return {
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
    }
  }

  const results: VerificationInput['commitsBetween'] = []
  for (let i = 0; i < compareData.commits.length; i += COMMIT_CONCURRENCY_LIMIT) {
    const batch = compareData.commits.slice(i, i + COMMIT_CONCURRENCY_LIMIT)
    const batchResults = await Promise.all(batch.map(processCommit))
    results.push(...batchResults)
  }
  return results
}

async function _refreshPrData(
  owner: string,
  repo: string,
  prNumber: number,
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[],
): Promise<void> {
  const typesToFetch = dataTypes ?? ['metadata', 'reviews', 'commits', 'checks', 'comments']

  try {
    const { metadata, reviews, commits, checks, comments } = await fetchPrFromGitHub(owner, repo, prNumber)

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

export async function fetchVerificationDataForAllDeployments(
  monitoredAppId: number,
  options?: { jobId?: number },
  onProgress?: (progress: BulkFetchProgress) => void,
): Promise<BulkFetchResult> {
  const jobId = options?.jobId

  const settingsStart = performance.now()
  const appSettings = await getAppSettings(monitoredAppId)
  logger.debug('Hentet app-innstillinger', {
    auditStartYear: appSettings.auditStartYear,
    durationMs: Math.round(performance.now() - settingsStart),
  })

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
    if (jobId && (await isSyncJobCancelled(jobId))) {
      await logSyncJobMessage(jobId, 'info', `Jobb avbrutt etter ${result.processed} av ${result.total} deployments`)
      break
    }

    try {
      const owner = deployment.detected_github_owner
      const repo = deployment.detected_github_repo_name
      const commitSha = deployment.commit_sha

      if (!deployment.default_branch) {
        result.skipped++
        result.processed++
        continue
      }
      const baseBranch = deployment.default_branch

      const hasCurrentData = deployment.has_pr_snapshot && deployment.has_compare_snapshot

      if (hasCurrentData) {
        result.skipped++
        logger.debug(`Hoppet over deployment ${deployment.id} (data finnes)`, {
          commitSha: commitSha.substring(0, 7),
          repo: `${owner}/${repo}`,
        })
      } else {
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
