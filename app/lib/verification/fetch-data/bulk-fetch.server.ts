import { pool } from '~/db/connection.server'
import { repositoryDeploymentSql } from '~/db/repository-deployment-sql'
import { effectiveDefaultBranchSql } from '~/db/repository-settings-sql'
import { heartbeatSyncJob, isSyncJobCancelled, logSyncJobMessage, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { GITHUB_RATE_LIMIT_SAFETY_BUFFER, getGitHubRateLimitRemaining } from '~/lib/github'
import {
  fetchWorkflowRunSnapshotIfMissing,
  parseWorkflowRunUrl,
  type WorkflowRunResolution,
  type WorkflowTriggerConfig,
} from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'
import { fetchVerificationData } from '../fetch-data.server'
import { updateDeploymentCommitChecks } from '../store-data.server'
import { CURRENT_SCHEMA_VERSION } from '../types'
import { refreshCommitChecksOnly } from './commit-checks.server'
import { refreshDisplayData as refreshPrDisplayData } from './pr-data.server'
import { backfillWorkflowTriggerConfig } from './workflow-triggers.server'

export interface BulkFetchProgress {
  total: number
  processed: number
  skipped: number
  fetched: number
  derivedFromRaw: number
  workflowTriggersFetched: number
  workflowRunSnapshotsFetched: number
  workflowRunSnapshotsAvailable: number
  workflowRunSnapshotsNotFound: number
  workflowRunSnapshotErrors: number
  errors: number
}

export interface BulkFetchResult extends BulkFetchProgress {
  errorDetails: Array<{ deploymentId: number; error: string }>
  rateLimited?: boolean
}

interface WorkflowRunSnapshotCandidate {
  deployment_id: number
  detected_github_owner: string
  detected_github_repo_name: string
  trigger_url: string
  github_repo_id: string
}

interface RepositoryWorkflowRunSnapshots {
  summary: WorkflowRunSnapshotSummary
  triggerResolutions: Map<string, WorkflowRunResolution>
}

function workflowRunKey(githubRepoId: string | number, runId: number): string {
  return `${githubRepoId}:${runId}`
}

type WorkflowRunSnapshotSummary = Pick<
  BulkFetchProgress,
  | 'workflowRunSnapshotsFetched'
  | 'workflowRunSnapshotsAvailable'
  | 'workflowRunSnapshotsNotFound'
  | 'workflowRunSnapshotErrors'
> & { rateLimited?: boolean }

async function fetchWorkflowRunSnapshotsForRepository(
  repositoryId: number,
  jobId?: number,
): Promise<RepositoryWorkflowRunSnapshots> {
  const { rows } = await pool.query<WorkflowRunSnapshotCandidate>(
    `SELECT
       d.id AS deployment_id,
       d.detected_github_owner,
       d.detected_github_repo_name,
       d.trigger_url,
       r.github_repo_id
     FROM deployments d
     JOIN repositories r ON r.id = $1
     WHERE ${repositoryDeploymentSql('$1')}
       AND d.detected_github_owner IS NOT NULL
       AND d.detected_github_repo_name IS NOT NULL
       AND d.trigger_url IS NOT NULL
     ORDER BY d.created_at DESC, d.id DESC`,
    [repositoryId],
  )

  const uniqueRuns = new Map<
    string,
    WorkflowRunSnapshotCandidate & { runId: number; urlOwner: string; urlRepo: string }
  >()
  for (const row of rows) {
    const parsed = parseWorkflowRunUrl(row.trigger_url, row.detected_github_owner, row.detected_github_repo_name)
    if (!parsed) continue
    const key = `${row.github_repo_id}:${parsed.runId}`
    if (!uniqueRuns.has(key)) {
      uniqueRuns.set(key, { ...row, runId: parsed.runId, urlOwner: parsed.owner, urlRepo: parsed.repo })
    }
  }

  const summary: WorkflowRunSnapshotSummary = {
    workflowRunSnapshotsFetched: 0,
    workflowRunSnapshotsAvailable: 0,
    workflowRunSnapshotsNotFound: 0,
    workflowRunSnapshotErrors: 0,
  }
  const total = uniqueRuns.size
  let processed = 0
  const triggerResolutions = new Map<string, WorkflowRunResolution>()

  for (const candidate of uniqueRuns.values()) {
    if (jobId && (await isSyncJobCancelled(jobId))) {
      await logSyncJobMessage(jobId, 'info', `Snapshot-henting avbrutt etter ${processed} av ${total} runs`)
      break
    }

    const snapshotResult = await fetchWorkflowRunSnapshotIfMissing(
      candidate.urlOwner,
      candidate.urlRepo,
      candidate.trigger_url,
      candidate.github_repo_id,
    )
    if (snapshotResult.status === 'rate_limited') {
      summary.rateLimited = true
      if (jobId) {
        await logSyncJobMessage(
          jobId,
          'warn',
          `Stoppet snapshot-henting etter ${processed} av ${total} runs — GitHub rate limit nesten oppbrukt (${snapshotResult.remaining} igjen)`,
        )
      }
      break
    } else if (snapshotResult.status === 'fetched') {
      triggerResolutions.set(workflowRunKey(candidate.github_repo_id, candidate.runId), {
        ...snapshotResult.workflowRunResolution,
      })
      summary.workflowRunSnapshotsFetched++
      summary.workflowRunSnapshotsAvailable++
    } else if (snapshotResult.status === 'already_present') {
      triggerResolutions.set(workflowRunKey(candidate.github_repo_id, candidate.runId), {
        ...snapshotResult.workflowRunResolution,
      })
      summary.workflowRunSnapshotsAvailable++
    } else if (snapshotResult.status === 'not_found') {
      triggerResolutions.set(workflowRunKey(candidate.github_repo_id, candidate.runId), {
        workflowTriggerConfig: null,
        branchName: null,
      })
      summary.workflowRunSnapshotsNotFound++
    } else if (snapshotResult.status === 'failed') {
      triggerResolutions.set(workflowRunKey(candidate.github_repo_id, candidate.runId), {
        workflowTriggerConfig: null,
        branchName: null,
      })
      summary.workflowRunSnapshotErrors++
      if (jobId) {
        await logSyncJobMessage(
          jobId,
          'warn',
          `Workflow-run-snapshot feilet for deployment ${candidate.deployment_id}`,
          { deploymentId: candidate.deployment_id, error: snapshotResult.error },
        )
      }
    }

    processed++
    if (jobId && (processed === 1 || processed === total || processed % 10 === 0)) {
      await updateSyncJobProgress(jobId, { total, processed, ...summary })
      await heartbeatSyncJob(jobId, 30)
    }
  }

  return { summary, triggerResolutions }
}

const ORDERED_DEPLOYMENTS_SELECT = (
  defaultBranchSql: string,
  repositoryIdSql = 'NULL::int',
  githubRepositoryIdSql = 'NULL::bigint',
) => `
      SELECT d.id, d.commit_sha, d.detected_github_owner, d.detected_github_repo_name,
             d.environment_name, d.trigger_url, d.workflow_trigger_config, d.commit_checks_data,
             d.commit_checks_checked_at, d.github_pr_number, d.monitored_app_id,
             ${defaultBranchSql} AS default_branch, ${repositoryIdSql} AS matched_repository_id,
             ${githubRepositoryIdSql} AS matched_github_repo_id, d.created_at,
             LAG(d.commit_sha) OVER (
               PARTITION BY d.detected_github_owner, d.detected_github_repo_name
               ORDER BY d.created_at ASC, d.id ASC
             ) AS prev_commit_sha
      FROM deployments d
      JOIN monitored_applications ma ON d.monitored_app_id = ma.id`

const SNAPSHOT_JOIN_AND_ORDER = `
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
        AND gcs.base_sha != gcs.head_sha
        AND gcs.schema_version = ${CURRENT_SCHEMA_VERSION}
      ORDER BY gcs.fetched_at DESC LIMIT 1
    ) cmp_snap ON od.prev_commit_sha IS NOT NULL
    ORDER BY od.created_at DESC`

interface DeploymentRow {
  id: number
  commit_sha: string
  detected_github_owner: string
  detected_github_repo_name: string
  environment_name: string
  trigger_url: string | null
  workflow_trigger_config: WorkflowTriggerConfig | null
  commit_checks_data: unknown
  commit_checks_checked_at: string | null
  github_pr_number: number | null
  monitored_app_id: number
  default_branch: string | null
  matched_repository_id: number | null
  matched_github_repo_id: string | null
  created_at: string
  prev_commit_sha: string | null
  has_pr_snapshot: boolean
  has_compare_snapshot: boolean
  has_checks_data: boolean
}

async function processDeployments(
  deployments: DeploymentRow[],
  jobId: number | undefined,
  refreshDisplayData: boolean | undefined,
  workflowRunSnapshotSummary: WorkflowRunSnapshotSummary,
  workflowTriggerResolutions?: Map<string, WorkflowRunResolution>,
  onProgress?: (progress: BulkFetchProgress) => void,
): Promise<BulkFetchResult> {
  const result: BulkFetchResult = {
    total: deployments.length,
    processed: 0,
    skipped: 0,
    fetched: 0,
    derivedFromRaw: 0,
    workflowTriggersFetched: 0,
    ...workflowRunSnapshotSummary,
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

    const rateLimitRemaining = getGitHubRateLimitRemaining()
    const snapshotRateLimited = workflowRunSnapshotSummary.rateLimited === true
    const quotaNearExhaustion = rateLimitRemaining !== null && rateLimitRemaining < GITHUB_RATE_LIMIT_SAFETY_BUFFER
    if (snapshotRateLimited || quotaNearExhaustion) {
      const rateLimitMessage = snapshotRateLimited
        ? 'GitHub rate limit reached during workflow-run snapshot fetching'
        : `GitHub rate limit near exhaustion (${rateLimitRemaining} remaining)`
      logger.warn(`⚠️  ${rateLimitMessage}, stopping bulk fetch`)
      if (jobId) {
        await logSyncJobMessage(
          jobId,
          'warn',
          `Stoppet etter ${result.processed} av ${result.total} deployments — ${rateLimitMessage}`,
        )
      }
      result.rateLimited = true
      break
    }

    try {
      const owner = deployment.detected_github_owner
      const repo = deployment.detected_github_repo_name
      const commitSha = deployment.commit_sha
      const parsedWorkflowRun = parseWorkflowRunUrl(deployment.trigger_url, owner, repo)
      const workflowTriggerResolution =
        workflowTriggerResolutions === undefined
          ? undefined
          : parsedWorkflowRun && deployment.matched_github_repo_id
            ? (workflowTriggerResolutions.get(
                workflowRunKey(deployment.matched_github_repo_id, parsedWorkflowRun.runId),
              ) ?? { workflowTriggerConfig: null, branchName: null })
            : { workflowTriggerConfig: null, branchName: null }

      const workflowTriggerFetched = await backfillWorkflowTriggerConfig(
        deployment.id,
        owner,
        repo,
        deployment.trigger_url,
        deployment.workflow_trigger_config,
        workflowTriggerResolution,
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
        const refreshed =
          refreshDisplayData && deployment.github_pr_number
            ? await refreshPrDisplayData(owner, repo, deployment.github_pr_number)
            : null
        if (refreshed) {
          result.fetched++
          if (jobId) {
            await logSyncJobMessage(jobId, 'info', `Oppdaterte visningsdata for deployment ${deployment.id}`, {
              commitSha: commitSha.substring(0, 7),
              repo: `${owner}/${repo}`,
            })
          }
        } else {
          result.skipped++
          logger.debug(`Hoppet over deployment ${deployment.id} (data finnes)`, {
            commitSha: commitSha.substring(0, 7),
            repo: `${owner}/${repo}`,
          })
        }
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
          workflowTriggerResolution,
        )
        if (refreshDisplayData && deployment.github_pr_number) {
          await refreshPrDisplayData(owner, repo, deployment.github_pr_number)
        }
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
          deployment.monitored_app_id,
          { forceRefresh: false },
          undefined,
          deployment.matched_repository_id ?? undefined,
          workflowTriggerResolution,
        )
        await updateDeploymentCommitChecks(deployment.id, input.commitChecks, input.commitChecksAttempted ?? true)
        const fetchDuration = Math.round(performance.now() - fetchStart)
        result.fetched++
        const derivedFromRaw =
          Boolean(input.dataFreshness.prDerivedFromRaw) || Boolean(input.dataFreshness.compareDerivedFromRaw)
        if (derivedFromRaw) {
          result.derivedFromRaw++
        }
        if (jobId) {
          await logSyncJobMessage(jobId, 'info', `Hentet data for deployment ${deployment.id}`, {
            commitSha: commitSha.substring(0, 7),
            repo: `${owner}/${repo}`,
            derivedFromRaw,
          })
        }
        logger.debug(`Hentet data for deployment ${deployment.id}`, {
          commitSha: commitSha.substring(0, 7),
          repo: `${owner}/${repo}`,
          fetchMs: fetchDuration,
          derivedFromRaw,
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
    if (result.rateLimited) {
      await logSyncJobMessage(
        jobId,
        'warn',
        `Datahenting delvis fullført (stoppet pga. rate limit): ${result.processed} av ${result.total} deployments behandlet, ${result.fetched} hentet (${result.derivedFromRaw} derivert fra rådata), ${result.skipped} hoppet over, ${result.workflowTriggersFetched} workflow-triggere hentet, ${result.errors} feil`,
      )
    } else {
      await logSyncJobMessage(
        jobId,
        'info',
        `Datahenting fullført: ${result.fetched} hentet (${result.derivedFromRaw} derivert fra rådata), ${result.skipped} hoppet over, ${result.workflowTriggersFetched} workflow-triggere hentet, ${result.errors} feil`,
      )
    }
  }

  return result
}

export async function fetchVerificationDataForAllDeployments(
  monitoredAppId: number,
  options?: { jobId?: number; refreshDisplayData?: boolean },
  onProgress?: (progress: BulkFetchProgress) => void,
): Promise<BulkFetchResult> {
  const jobId = options?.jobId
  const refreshDisplayData = options?.refreshDisplayData

  const query = `
    WITH ordered_deployments AS (
      ${ORDERED_DEPLOYMENTS_SELECT(effectiveDefaultBranchSql('ma'))}
      WHERE d.monitored_app_id = $1
        AND d.commit_sha IS NOT NULL
        AND d.detected_github_owner IS NOT NULL
        AND d.detected_github_repo_name IS NOT NULL
        AND ${VALID_COMMIT_SHA_SQL}
    )
    ${SNAPSHOT_JOIN_AND_ORDER}`

  const queryStart = performance.now()
  const deploymentsResult = await pool.query(query, [monitoredAppId])

  const deployments = deploymentsResult.rows
  logger.debug(`Fant ${deployments.length} deployments å sjekke`, {
    durationMs: Math.round(performance.now() - queryStart),
  })

  return processDeployments(
    deployments,
    jobId,
    refreshDisplayData,
    {
      workflowRunSnapshotsFetched: 0,
      workflowRunSnapshotsAvailable: 0,
      workflowRunSnapshotsNotFound: 0,
      workflowRunSnapshotErrors: 0,
    },
    undefined,
    onProgress,
  )
}

export async function fetchVerificationDataForRepository(
  repositoryId: number,
  options?: { jobId?: number; refreshDisplayData?: boolean },
  onProgress?: (progress: BulkFetchProgress) => void,
): Promise<BulkFetchResult> {
  const jobId = options?.jobId
  const refreshDisplayData = options?.refreshDisplayData

  const query = `
    WITH ordered_deployments AS (
      ${ORDERED_DEPLOYMENTS_SELECT(
        `COALESCE((SELECT r_settings.default_branch FROM repositories r_settings WHERE r_settings.id = $1), ma.default_branch)`,
        '$1::int',
        `(SELECT r_settings.github_repo_id FROM repositories r_settings WHERE r_settings.id = $1)`,
      )}
      WHERE d.commit_sha IS NOT NULL
        AND d.detected_github_owner IS NOT NULL
        AND d.detected_github_repo_name IS NOT NULL
        AND ${VALID_COMMIT_SHA_SQL}
        AND ${repositoryDeploymentSql('$1')}
    )
    ${SNAPSHOT_JOIN_AND_ORDER}`

  const queryStart = performance.now()
  const deploymentsResult = await pool.query(query, [repositoryId])
  const workflowRunSnapshots = await fetchWorkflowRunSnapshotsForRepository(repositoryId, jobId)

  const deployments = deploymentsResult.rows
  logger.debug(`Fant ${deployments.length} deployments å sjekke for repository ${repositoryId}`, {
    durationMs: Math.round(performance.now() - queryStart),
  })

  return processDeployments(
    deployments,
    jobId,
    refreshDisplayData,
    workflowRunSnapshots.summary,
    workflowRunSnapshots.triggerResolutions,
    onProgress,
  )
}
