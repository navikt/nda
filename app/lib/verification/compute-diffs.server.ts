/**
 * Compute Verification Diffs
 *
 * Pre-computes differences between stored four_eyes_status (V1) and
 * what V2 verification would produce, storing the results in the
 * verification_diffs table for fast page loads.
 *
 * Run as a background sync job (reverify_app job type).
 */

import { getImplicitApprovalSettings } from '~/db/app-settings.server'
import { pool } from '~/db/connection.server'
import {
  getCompareSnapshotForCommit,
  getDeploymentsWithCompareData,
  getPreviousDeploymentForDiff,
  getPrSnapshotsForDiff,
} from '~/db/verification-diff.server'
import { logger } from '~/lib/logger.server'
import { buildCommitsBetweenFromCache } from './fetch-data.server'
import type { CompareData, PrCommit, PrMetadata, PrReview, VerificationInput } from './types'
import { verifyDeployment } from './verify'

interface ComputeDiffsOptions {
  jobId?: number
  onProgress?: (processed: number, total: number, diffsFound: number) => void
}

interface ComputeDiffsResult {
  deploymentsChecked: number
  diffsFound: number
  skipped: number
  errors: number
}

const STATUS_EQUIVALENCES: Record<string, string> = {
  approved_pr: 'approved',
  pending_approval: 'pending',
}

export function normalizeStatus(status: string | null): string | null {
  if (!status) return status
  return STATUS_EQUIVALENCES[status] || status
}

/**
 * Compute all verification diffs for a monitored app and store them in the database.
 * Replaces all existing diffs for the app with fresh computation.
 */
export async function computeVerificationDiffs(
  monitoredAppId: number,
  options: ComputeDiffsOptions = {},
): Promise<ComputeDiffsResult> {
  const deployments = await getDeploymentsWithCompareData(monitoredAppId)
  const implicitApprovalSettings = await getImplicitApprovalSettings(monitoredAppId)

  const result: ComputeDiffsResult = {
    deploymentsChecked: 0,
    diffsFound: 0,
    skipped: 0,
    errors: 0,
  }

  // Collect diffs to batch-insert at the end
  const diffs: Array<{
    deploymentId: number
    oldStatus: string | null
    newStatus: string
    oldHasFourEyes: boolean | null
    newHasFourEyes: boolean
  }> = []

  for (const row of deployments) {
    try {
      // Skip manually approved — they were approved by a human
      if (row.four_eyes_status === 'manually_approved') {
        result.skipped++
        result.deploymentsChecked++
        continue
      }

      const prevRow = await getPreviousDeploymentForDiff(row.id, row.environment_name)
      const previousDeployment = prevRow
        ? { id: prevRow.id, commitSha: prevRow.commit_sha, createdAt: prevRow.created_at.toISOString() }
        : null

      const compareSnapshot = await getCompareSnapshotForCommit(row.commit_sha)
      if (!compareSnapshot) {
        result.skipped++
        result.deploymentsChecked++
        continue
      }

      const compareData = compareSnapshot.data as CompareData
      const owner = row.detected_github_owner as string
      const repo = row.detected_github_repo_name as string
      const baseBranch = row.default_branch || 'main'

      const commitsBetween = await buildCommitsBetweenFromCache(owner, repo, baseBranch, compareData, {
        cacheOnly: true,
      })

      let deployedPr: VerificationInput['deployedPr'] = null
      if (row.github_pr_number) {
        const snapshotMap = await getPrSnapshotsForDiff(row.github_pr_number)
        if (snapshotMap.has('metadata') && snapshotMap.has('reviews') && snapshotMap.has('commits')) {
          deployedPr = {
            number: row.github_pr_number,
            url: `https://github.com/${owner}/${repo}/pull/${row.github_pr_number}`,
            metadata: snapshotMap.get('metadata') as PrMetadata,
            reviews: snapshotMap.get('reviews') as PrReview[],
            commits: snapshotMap.get('commits') as PrCommit[],
          }
        }
      }

      const input: VerificationInput = {
        deploymentId: row.id,
        commitSha: row.commit_sha,
        repository: `${owner}/${repo}`,
        environmentName: row.environment_name,
        baseBranch,
        repositoryStatus: 'active',
        commitOnBaseBranch: true,
        auditStartYear: row.audit_start_year,
        implicitApprovalSettings: implicitApprovalSettings ?? { mode: 'off' },
        previousDeployment,
        deployedPr,
        commitsBetween,
        dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
      }

      const newResult = verifyDeployment(input)

      const normalizedOldStatus = normalizeStatus(row.four_eyes_status)
      const normalizedNewStatus = normalizeStatus(newResult.status)
      const statusDifferent = normalizedOldStatus !== normalizedNewStatus
      const fourEyesDifferent = row.has_four_eyes !== newResult.hasFourEyes

      if (statusDifferent || fourEyesDifferent) {
        diffs.push({
          deploymentId: row.id,
          oldStatus: row.four_eyes_status,
          newStatus: newResult.status,
          oldHasFourEyes: row.has_four_eyes,
          newHasFourEyes: newResult.hasFourEyes,
        })
      }

      result.deploymentsChecked++
      options.onProgress?.(result.deploymentsChecked, deployments.length, diffs.length)
    } catch (err) {
      logger.error(`Error computing diff for deployment ${row.id}`, err instanceof Error ? err : new Error(String(err)))
      result.errors++
      result.deploymentsChecked++
    }
  }

  // Atomic replace: delete old diffs and insert new ones in a transaction
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM verification_diffs WHERE monitored_app_id = $1', [monitoredAppId])

    for (const diff of diffs) {
      await client.query(
        `INSERT INTO verification_diffs 
           (monitored_app_id, deployment_id, old_status, new_status, old_has_four_eyes, new_has_four_eyes, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [monitoredAppId, diff.deploymentId, diff.oldStatus, diff.newStatus, diff.oldHasFourEyes, diff.newHasFourEyes],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  result.diffsFound = diffs.length
  logger.info(
    `Verification diffs computed: ${result.deploymentsChecked} checked, ${result.diffsFound} diffs, ${result.skipped} skipped, ${result.errors} errors`,
  )

  return result
}
