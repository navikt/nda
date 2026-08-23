import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { markPrDataUnavailable, savePrSnapshotsBatch } from '~/db/github-data.server'
import { APPROVED_STATUSES_SQL } from '~/lib/four-eyes-status'
import { getBranchFromWorkflowRun, getSingleCommitMessage, isCommitOnBranch } from '~/lib/github'
import { buildBranchMismatch } from './branch-mismatch'
import { fetchCommitChecks, getCachedCommitChecks } from './fetch-data/commit-checks.server'
import { fetchCommitsBetween } from './fetch-data/commits-between.server'
import { type FetchOptions, fetchDeployedPrData, fetchPrFromGitHub } from './fetch-data/pr-data.server'
import { getPreviousDeployment } from './fetch-data/previous-deployment.server'
import { fetchWorkflowTriggerConfig } from './fetch-data/workflow-triggers.server'
import type { PrDataType, RepositoryStatus } from './types'
import {
  type CompareSummary,
  CURRENT_SCHEMA_VERSION,
  type ImplicitApprovalSettings,
  type VerificationInput,
} from './types'

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

  const workflowTrigger = await fetchWorkflowTriggerConfig(deploymentId, owner, repo, triggerUrl, options)

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

  let commitChecks: VerificationInput['commitChecks']
  let commitChecksAttempted: boolean | undefined
  if (!options?.forceRefresh) {
    const cached = await getCachedCommitChecks(deploymentId)
    if (cached.isCached) {
      commitChecks = cached.commitChecks
      commitChecksAttempted = true
    }
  }
  if (commitChecksAttempted === undefined) {
    const fetched = await fetchCommitChecks(
      owner,
      repo,
      commitSha,
      deployedPr?.metadata.headSha,
      workflowTrigger?.checkSuiteId,
    )
    commitChecks = fetched.commitChecks
    commitChecksAttempted = fetched.attempted
  }

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
    workflowTrigger,
    commitChecks,
    commitChecksAttempted,
    dataFreshness: {
      deployedPrFetchedAt: deployedPr ? new Date() : null,
      commitsFetchedAt: commitsBetween.length > 0 ? new Date() : null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
  }
}

export type { CommitChecksFetchResult } from './fetch-data/commit-checks.server'
export { fetchCommitChecks, refreshCommitChecksOnly } from './fetch-data/commit-checks.server'
export { buildCommitsBetweenFromCache, resolveNoDiffDetection } from './fetch-data/commits-between.server'
export type { FetchOptions } from './fetch-data/pr-data.server'
export { fetchPrFromGitHub, findPrForCommit } from './fetch-data/pr-data.server'
export type { WorkflowTriggerBackfillResult } from './fetch-data/workflow-triggers.server'
export {
  backfillWorkflowTriggerConfig,
  backfillWorkflowTriggerConfigForAllApps,
  countDeploymentsMissingWorkflowTriggerConfig,
} from './fetch-data/workflow-triggers.server'

export async function getAppSettings(monitoredAppId: number): Promise<{
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

async function _refreshPrData(
  owner: string,
  repo: string,
  prNumber: number,
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[],
): Promise<void> {
  const typesToFetch = dataTypes ?? ['metadata', 'reviews', 'commits', 'checks', 'comments']

  try {
    const { metadata, reviews, commits, checks, comments, raw } = await fetchPrFromGitHub(owner, repo, prNumber)

    const snapshots: Array<{ dataType: PrDataType; data: unknown }> = []

    if (typesToFetch.includes('metadata')) {
      snapshots.push({ dataType: 'metadata', data: metadata })
      snapshots.push({ dataType: 'raw_pr', data: raw.pr })
    }
    if (typesToFetch.includes('reviews')) {
      snapshots.push({ dataType: 'reviews', data: reviews })
      snapshots.push({ dataType: 'raw_reviews', data: raw.reviews })
    }
    if (typesToFetch.includes('commits')) {
      snapshots.push({ dataType: 'commits', data: commits })
      snapshots.push({ dataType: 'raw_commits', data: raw.commits })
    }
    if (typesToFetch.includes('checks')) {
      snapshots.push({ dataType: 'checks', data: checks })
    }
    if (typesToFetch.includes('comments')) {
      snapshots.push({ dataType: 'comments', data: comments })
      snapshots.push({ dataType: 'raw_comments', data: raw.issueComments })
      snapshots.push({ dataType: 'raw_review_comments', data: raw.reviewComments })
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
