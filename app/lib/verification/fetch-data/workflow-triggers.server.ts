import { pool } from '~/db/connection.server'
import { heartbeatSyncJob, isSyncJobCancelled, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { resolveWorkflowRunDetails, WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import type { VerificationInput } from '../types'

interface FetchOptions {
  forceRefresh?: boolean
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
}

export interface WorkflowTriggerConfigFetchResult {
  config: VerificationInput['workflowTrigger']
  repositoryId: number | null
  headBranch: string | null
  // True when this call made a live GitHub request for the workflow run (i.e. the cached
  // workflow_trigger_config wasn't reusable); callers can use this to avoid a redundant second
  // live call for data (e.g. head branch) that this same request already resolved.
  liveFetchPerformed: boolean
}

export async function fetchWorkflowTriggerConfig(
  deploymentId: number,
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
  options?: FetchOptions,
): Promise<WorkflowTriggerConfigFetchResult> {
  if (!triggerUrl) return { config: undefined, repositoryId: null, headBranch: null, liveFetchPerformed: false }

  let cached: Awaited<ReturnType<typeof getCachedWorkflowTriggerConfig>>
  if (!options?.forceRefresh) {
    cached = await getCachedWorkflowTriggerConfig(deploymentId)
    // Only fully reuse the cache when github_repo_id is already resolved. A config can have
    // schemaVersion 3 with no repository id yet — either cached before this backfill existed, or
    // written by backfillWorkflowTriggerConfig() — in which case a live lookup is still needed
    // once to fill it in.
    if (cached && cached.githubRepoId !== null) {
      return {
        config: cached.config,
        repositoryId: cached.githubRepoId,
        headBranch: null,
        liveFetchPerformed: false,
      }
    }
  }

  const { workflowTrigger, repositoryId, headBranch } = await resolveWorkflowRunDetails(owner, repo, triggerUrl)
  // If the live lookup can't reconstruct a trigger config (e.g. the workflow run has since 404'd),
  // keep serving the previously-cached config instead of discarding it — only the repository id
  // resolution failed here, not the config itself, and callers (e.g. fetchCommitChecks) rely on a
  // missing config falling back to unscoped data.
  return { config: workflowTrigger ?? cached?.config, repositoryId, headBranch, liveFetchPerformed: true }
}

async function getCachedWorkflowTriggerConfig(
  deploymentId: number,
): Promise<{ config: VerificationInput['workflowTrigger']; githubRepoId: number | null } | undefined> {
  const existing = await pool.query<{
    workflow_trigger_config: VerificationInput['workflowTrigger'] | null
    github_repo_id: string | null
  }>(`SELECT workflow_trigger_config, github_repo_id FROM deployments WHERE id = $1`, [deploymentId])
  const row = existing.rows[0]
  if (row?.workflow_trigger_config?.schemaVersion === WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION) {
    return {
      config: row.workflow_trigger_config,
      githubRepoId: row.github_repo_id !== null ? Number(row.github_repo_id) : null,
    }
  }
  return undefined
}

export async function backfillWorkflowTriggerConfig(
  deploymentId: number,
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
  currentConfig?: VerificationInput['workflowTrigger'] | null,
  currentGithubRepoId?: number | null,
): Promise<boolean> {
  if (!triggerUrl) return false
  // Only skip re-resolving when the config is current AND github_repo_id is already known —
  // otherwise a config cached before repo-id extraction existed (or written by a prior call here
  // that failed to extract it) would be stuck with a NULL github_repo_id forever.
  if (currentConfig?.schemaVersion === WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION && currentGithubRepoId != null) {
    return false
  }

  const { workflowTrigger, repositoryId } = await resolveWorkflowRunDetails(owner, repo, triggerUrl)
  if (!workflowTrigger) return false

  await pool.query(
    `UPDATE deployments
     SET
       workflow_trigger_config = $1::jsonb,
       github_repo_id = COALESCE(deployments.github_repo_id, $3::bigint),
       github_repo_id_backfill_attempted_at = CASE
         WHEN deployments.github_repo_id IS NULL AND $3::bigint IS NOT NULL THEN NULL
         ELSE deployments.github_repo_id_backfill_attempted_at
       END
     WHERE id = $2`,
    [JSON.stringify(workflowTrigger), deploymentId, repositoryId],
  )
  return true
}

interface DeploymentMissingWorkflowTrigger {
  id: number
  detected_github_owner: string
  detected_github_repo_name: string
  trigger_url: string
  workflow_trigger_config: VerificationInput['workflowTrigger'] | null
}

const MISSING_WORKFLOW_TRIGGER_CONFIG_SQL = `
  trigger_url IS NOT NULL
  AND detected_github_owner IS NOT NULL
  AND detected_github_repo_name IS NOT NULL
  AND (
    workflow_trigger_config IS NULL
    OR (workflow_trigger_config->>'schemaVersion')::int IS DISTINCT FROM $1
  )
`

export async function countDeploymentsMissingWorkflowTriggerConfig(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM deployments WHERE ${MISSING_WORKFLOW_TRIGGER_CONFIG_SQL}`,
    [WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION],
  )
  return parseInt(result.rows[0].count, 10)
}

export interface WorkflowTriggerBackfillResult {
  processed: number
  total: number
  fetched: number
  errors: number
}

export async function backfillWorkflowTriggerConfigForAllApps(options?: {
  jobId?: number
  onProgress?: (progress: WorkflowTriggerBackfillResult) => void | Promise<void>
}): Promise<WorkflowTriggerBackfillResult> {
  const jobId = options?.jobId

  const deploymentsResult = await pool.query<DeploymentMissingWorkflowTrigger>(
    `SELECT id, detected_github_owner, detected_github_repo_name, trigger_url, workflow_trigger_config
     FROM deployments
     WHERE ${MISSING_WORKFLOW_TRIGGER_CONFIG_SQL}
     ORDER BY created_at DESC`,
    [WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION],
  )
  const deployments = deploymentsResult.rows

  const result: WorkflowTriggerBackfillResult = {
    processed: 0,
    total: deployments.length,
    fetched: 0,
    errors: 0,
  }

  for (const deployment of deployments) {
    if (jobId && (await isSyncJobCancelled(jobId))) {
      break
    }

    try {
      const fetched = await backfillWorkflowTriggerConfig(
        deployment.id,
        deployment.detected_github_owner,
        deployment.detected_github_repo_name,
        deployment.trigger_url,
        deployment.workflow_trigger_config,
      )
      if (fetched) {
        result.fetched++
      }
    } catch (err) {
      logger.error(
        `Henting av workflow-trigger feilet for deployment ${deployment.id}`,
        err instanceof Error ? err : new Error(String(err)),
      )
      result.errors++
    }

    result.processed++

    if (jobId && result.processed % 10 === 0) {
      await updateSyncJobProgress(jobId, result as unknown as Record<string, unknown>)
      await heartbeatSyncJob(jobId, 30)
    }
    await options?.onProgress?.(result)
  }

  if (jobId) {
    await updateSyncJobProgress(jobId, result as unknown as Record<string, unknown>)
  }

  return result
}
