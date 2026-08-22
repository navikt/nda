import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { markPrDataUnavailable, savePrSnapshotsBatch } from '~/db/github-data.server'
import { heartbeatSyncJob, isSyncJobCancelled, logSyncJobMessage, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { APPROVED_STATUSES_SQL } from '~/lib/four-eyes-status'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { getBranchFromWorkflowRun, getSingleCommitMessage, isCommitOnBranch } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { buildBranchMismatch } from './branch-mismatch'
import { fetchCommitChecks, getCachedCommitChecks, refreshCommitChecksOnly } from './fetch-data/commit-checks.server'
import { fetchCommitsBetween } from './fetch-data/commits-between.server'
import { type FetchOptions, fetchDeployedPrData, fetchPrFromGitHub } from './fetch-data/pr-data.server'
import { getPreviousDeployment } from './fetch-data/previous-deployment.server'
import { backfillWorkflowTriggerConfig, fetchWorkflowTriggerConfig } from './fetch-data/workflow-triggers.server'
import { updateDeploymentCommitChecks } from './store-data.server'
import type { RepositoryStatus } from './types'
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
  workflowTriggersFetched: number
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
             d.environment_name, d.trigger_url, d.workflow_trigger_config, d.commit_checks_data,
             d.commit_checks_checked_at, d.github_pr_number,
             ma.default_branch, d.created_at,
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
           (od.prev_commit_sha IS NULL OR cmp_snap.id IS NOT NULL) AS has_compare_snapshot,
           (od.commit_checks_checked_at IS NOT NULL) AS has_checks_data
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
    workflowTriggersFetched: 0,
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

      const workflowTriggerFetched = await backfillWorkflowTriggerConfig(
        deployment.id,
        owner,
        repo,
        deployment.trigger_url,
        deployment.workflow_trigger_config,
      )
      if (workflowTriggerFetched) {
        result.workflowTriggersFetched++
        if (jobId) {
          await logSyncJobMessage(jobId, 'info', `Hentet workflow-trigger for deployment ${deployment.id}`, {
            commitSha: commitSha.substring(0, 7),
            repo: `${owner}/${repo}`,
          })
        }
      }

      if (!deployment.default_branch) {
        result.skipped++
        result.processed++
        continue
      }
      const baseBranch = deployment.default_branch

      const hasCurrentData = deployment.has_pr_snapshot && deployment.has_compare_snapshot
      const hasChecksData = deployment.has_checks_data

      if (hasCurrentData && hasChecksData) {
        result.skipped++
        logger.debug(`Hoppet over deployment ${deployment.id} (data finnes)`, {
          commitSha: commitSha.substring(0, 7),
          repo: `${owner}/${repo}`,
        })
      } else if (hasCurrentData) {
        const fetchStart = performance.now()
        await refreshCommitChecksOnly(
          deployment.id,
          owner,
          repo,
          commitSha,
          deployment.github_pr_number,
          deployment.trigger_url,
          deployment.workflow_trigger_config,
        )
        const fetchDuration = Math.round(performance.now() - fetchStart)
        result.fetched++
        if (jobId) {
          await logSyncJobMessage(jobId, 'info', `Hentet checks for deployment ${deployment.id}`, {
            commitSha: commitSha.substring(0, 7),
            repo: `${owner}/${repo}`,
          })
        }
        logger.debug(`Hentet checks for deployment ${deployment.id}`, {
          commitSha: commitSha.substring(0, 7),
          repo: `${owner}/${repo}`,
          fetchMs: fetchDuration,
        })
      } else {
        const fetchStart = performance.now()
        const input = await fetchVerificationData(
          deployment.id,
          commitSha,
          `${owner}/${repo}`,
          deployment.environment_name,
          baseBranch,
          monitoredAppId,
          { forceRefresh: false }, // Only fetch what's missing
        )
        await updateDeploymentCommitChecks(deployment.id, input.commitChecks, input.commitChecksAttempted ?? true)
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
      `Datahenting fullført: ${result.fetched} hentet, ${result.skipped} hoppet over, ${result.workflowTriggersFetched} workflow-triggere hentet, ${result.errors} feil`,
    )
  }

  return result
}
