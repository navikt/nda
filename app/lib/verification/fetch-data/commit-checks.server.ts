import { pool } from '~/db/connection.server'
import { saveCommitSnapshot } from '~/db/github-data.server'
import {
  getChecksForCommit,
  getWorkflowTriggerConfig,
  WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION,
  type WorkflowTriggerConfig,
} from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { updateDeploymentCommitChecks } from '../store-data.server'
import type { VerificationInput } from '../types'
import { getCachedPrData } from './pr-data.server'

async function resolvePrHeadShaFallback(
  owner: string,
  repo: string,
  prNumber: number | null,
): Promise<string | undefined> {
  if (!prNumber) return undefined
  const prData = await getCachedPrData(owner, repo, prNumber)
  return prData?.head_sha
}

export type CommitChecksFetchResult = {
  commitChecks: VerificationInput['commitChecks']
  attempted: boolean
}

export async function fetchCommitChecks(
  owner: string,
  repo: string,
  commitSha: string,
  fallbackSha?: string | null,
  checkSuiteId?: number | null,
): Promise<CommitChecksFetchResult> {
  try {
    const result = await getChecksForCommit(owner, repo, commitSha, fallbackSha, checkSuiteId)
    if (!result) return { commitChecks: undefined, attempted: true }

    await saveCommitSnapshot(owner, repo, result.matchedSha, 'checks', result.rawSnapshot)

    return {
      commitChecks: { checked_sha: result.matchedSha, checks_passed: result.checks_passed, checks: result.checks },
      // Only a definitive result (no check runs found, or all check runs completed) counts as "attempted":
      // otherwise the bulk backfill job would treat an in-progress check run as permanently resolved and
      // never re-fetch it once the commit's checks actually finish.
      attempted: result.isDefinitive,
    }
  } catch (error) {
    logger.warn(`Could not fetch commit checks for ${owner}/${repo}@${commitSha}: ${error}`)
    return { commitChecks: undefined, attempted: false }
  }
}

/**
 * Fetches and stores only commit_checks_data for a deployment that already has its
 * other verification data (PR/compare snapshots), without re-running the full
 * verification pipeline. Used both by the "fetch all deployments" admin backfill and
 * by the periodic job that keeps polling checks for deployments whose four_eyes_status
 * is already resolved (see reverifyPendingChecks() in app/lib/sync/github-verify.server.ts).
 */
export async function refreshCommitChecksOnly(
  deploymentId: number,
  owner: string,
  repo: string,
  commitSha: string,
  githubPrNumber: number | null,
  triggerUrl?: string | null,
  cachedWorkflowTrigger?: WorkflowTriggerConfig | null,
): Promise<CommitChecksFetchResult> {
  const fallbackSha = await resolvePrHeadShaFallback(owner, repo, githubPrNumber)
  const checkSuiteId = await resolveCheckSuiteId(owner, repo, triggerUrl, cachedWorkflowTrigger)
  const result = await fetchCommitChecks(owner, repo, commitSha, fallbackSha, checkSuiteId)
  await updateDeploymentCommitChecks(deploymentId, result.commitChecks, result.attempted)
  return result
}

async function resolveCheckSuiteId(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
  cachedWorkflowTrigger: WorkflowTriggerConfig | null | undefined,
): Promise<number | null> {
  if (cachedWorkflowTrigger?.schemaVersion === WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION) {
    return cachedWorkflowTrigger.checkSuiteId
  }
  if (!triggerUrl) return null
  const workflowTrigger = await getWorkflowTriggerConfig(owner, repo, triggerUrl)
  return workflowTrigger?.checkSuiteId ?? null
}

export async function getCachedCommitChecks(
  deploymentId: number,
): Promise<{ isCached: true; commitChecks: VerificationInput['commitChecks'] } | { isCached: false }> {
  const existing = await pool.query<{
    commit_checks_data: VerificationInput['commitChecks'] | null
    commit_checks_checked_at: Date | null
  }>(`SELECT commit_checks_data, commit_checks_checked_at FROM deployments WHERE id = $1`, [deploymentId])
  const row = existing.rows[0]
  // commit_checks_checked_at is only ever set for a definitive result (see fetchCommitChecks above), so
  // its presence means it's safe to reuse without a redundant GitHub call + duplicate archive snapshot.
  if (!row?.commit_checks_checked_at) return { isCached: false }
  return { isCached: true, commitChecks: row.commit_checks_data ?? undefined }
}
