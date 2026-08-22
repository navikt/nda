import { pool } from '~/db/connection.server'
import { heartbeatSyncJob, isSyncJobCancelled, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { getWorkflowTriggerConfig, WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import type { VerificationInput } from '../types'

interface FetchOptions {
  forceRefresh?: boolean
  dataTypes?: ('metadata' | 'reviews' | 'commits' | 'comments' | 'checks')[]
}

export async function fetchWorkflowTriggerConfig(
  deploymentId: number,
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
  options?: FetchOptions,
): Promise<VerificationInput['workflowTrigger']> {
  if (!triggerUrl) return undefined

  if (!options?.forceRefresh) {
    const cached = await getCachedWorkflowTriggerConfig(deploymentId)
    if (cached) return cached
  }

  const workflowTrigger = await getWorkflowTriggerConfig(owner, repo, triggerUrl)
  return workflowTrigger ?? undefined
}

async function getCachedWorkflowTriggerConfig(
  deploymentId: number,
): Promise<VerificationInput['workflowTrigger'] | undefined> {
  const existing = await pool.query<{ workflow_trigger_config: VerificationInput['workflowTrigger'] | null }>(
    `SELECT workflow_trigger_config FROM deployments WHERE id = $1`,
    [deploymentId],
  )
  const cached = existing.rows[0]?.workflow_trigger_config
  if (cached?.schemaVersion === WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION) {
    return cached
  }
  return undefined
}

export async function backfillWorkflowTriggerConfig(
  deploymentId: number,
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
  currentConfig?: VerificationInput['workflowTrigger'] | null,
): Promise<boolean> {
  if (!triggerUrl) return false
  if (currentConfig?.schemaVersion === WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION) return false

  const workflowTrigger = await getWorkflowTriggerConfig(owner, repo, triggerUrl)
  if (!workflowTrigger) return false

  await pool.query(`UPDATE deployments SET workflow_trigger_config = $1::jsonb WHERE id = $2`, [
    JSON.stringify(workflowTrigger),
    deploymentId,
  ])
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
