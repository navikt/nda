import { pool } from '~/db/connection.server'
import { heartbeatSyncJob, isSyncJobCancelled, logSyncJobMessage, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { logger } from '~/lib/logger.server'
import { fetchVerificationData, getAppSettings } from '../fetch-data.server'
import { updateDeploymentCommitChecks } from '../store-data.server'
import { CURRENT_SCHEMA_VERSION } from '../types'
import { refreshCommitChecksOnly } from './commit-checks.server'
import { backfillWorkflowTriggerConfig } from './workflow-triggers.server'

export interface BulkFetchProgress {
  total: number
  processed: number
  skipped: number
  fetched: number
  workflowTriggersFetched: number
  errors: number
}

export interface BulkFetchResult extends BulkFetchProgress {
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
