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
  getDeploymentsForDiffComputation,
  getPreviousDeploymentForDiff,
  getPrSnapshotsForDiff,
} from '~/db/verification-diff.server'
import { isProtectedStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { buildCommitsBetweenFromCache, fetchVerificationData } from './fetch-data.server'
import type { CompareData, PrCommit, PrMetadata, PrReview, VerificationInput } from './types'
import { verifyDeployment } from './verify'

interface ComputeDiffsOptions {
  jobId?: number
  onProgress?: (processed: number, total: number, diffsFound: number) => void | Promise<void>
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
  const deployments = await getDeploymentsForDiffComputation(monitoredAppId)
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
    errorReason: string | null
  }> = []

  for (const row of deployments) {
    try {
      // Skip protected statuses — explicit admin actions that V2 cannot reproduce.
      if (isProtectedStatus(row.four_eyes_status ?? '')) {
        result.skipped++
        result.deploymentsChecked++
        continue
      }

      const owner = row.detected_github_owner as string
      const repo = row.detected_github_repo_name as string

      if (!row.default_branch) {
        result.skipped++
        result.deploymentsChecked++
        continue
      }
      const baseBranch = row.default_branch

      let input: VerificationInput
      let precomputedResult: ReturnType<typeof verifyDeployment> | null = null

      const compareSnapshot = await getCompareSnapshotForCommit(row.commit_sha)
      if (compareSnapshot) {
        // Build input from cached data
        const prevRow = await getPreviousDeploymentForDiff(row.id, row.environment_name)
        const previousDeployment = prevRow
          ? { id: prevRow.id, commitSha: prevRow.commit_sha, createdAt: prevRow.created_at.toISOString() }
          : null

        const compareData = compareSnapshot.data as CompareData

        // Detect likely invalid cache: 0 commits between different SHAs
        // Only trust compare metadata if it exists (schema v4+); v3 snapshots won't have it
        const hasCompareMetadata = compareData.compare !== undefined
        const hasSuspiciousCache =
          compareData.commits.length === 0 &&
          previousDeployment &&
          previousDeployment.commitSha !== row.commit_sha &&
          (!hasCompareMetadata || !compareData.compare.noDiffDetected)

        // CRITICAL: Validate cache snapshot was created for the correct deployment range
        // getCompareSnapshotForCommit() selects by head_sha only, so base_sha can mismatch
        // If snapshot's base differs from previousDeployment, the noDiffDetected flag is for the wrong range
        const cacheBaseMismatch = previousDeployment && compareSnapshot.base_sha !== previousDeployment.commitSha

        if (hasSuspiciousCache || cacheBaseMismatch) {
          const reason = cacheBaseMismatch
            ? `snapshot base_sha ${compareSnapshot.base_sha} ≠ previousDeployment ${previousDeployment?.commitSha}`
            : `0 commits between different SHAs`
          logger.info(`   🔄 Cached compare validation failed for deployment ${row.id}: ${reason} — refetching`)
          input = await fetchVerificationData(
            row.id,
            row.commit_sha,
            `${owner}/${repo}`,
            row.environment_name,
            baseBranch,
            monitoredAppId,
          )
        } else {
          // First pass: fast cache-only check for commitsBetween
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

          input = {
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
            compareSummary: hasCompareMetadata ? compareData.compare : null,
            dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
          }

          // Double-check: if cache-only produced a different status than
          // what's stored, or if the deployed PR couldn't be resolved from
          // cache, re-run with forceRefresh to confirm. This prevents false
          // diffs from stale empty PR caches without making API calls for
          // all deployments. Stale caches on intermediate commits are healed
          // via interactive re-verification ("Apply selected" in admin UI).
          const cacheOnlyResult = verifyDeployment(input)
          const normalizedOldStatus = normalizeStatus(row.four_eyes_status)
          const normalizedCacheStatus = normalizeStatus(cacheOnlyResult.status)
          const missingPrSnapshot = row.github_pr_number != null && deployedPr == null

          if (normalizedOldStatus !== normalizedCacheStatus || missingPrSnapshot) {
            const reasons: string[] = []
            if (normalizedOldStatus !== normalizedCacheStatus) {
              reasons.push(`status diff: ${row.four_eyes_status} → ${cacheOnlyResult.status}`)
            }
            if (missingPrSnapshot) {
              reasons.push(`missing PR snapshot: DB has PR#${row.github_pr_number} but cached snapshot is incomplete`)
            }
            logger.info(`   🔄 Re-fetching deployment ${row.id}: ${reasons.join(', ')}`)

            try {
              input = await fetchVerificationData(
                row.id,
                row.commit_sha,
                `${owner}/${repo}`,
                row.environment_name,
                baseBranch,
                monitoredAppId,
                { forceRefresh: true },
              )
            } catch (err) {
              // If forceRefresh fails (e.g., deleted PR, API error), fall back
              // to the cache-only result. Note: no failure marker is persisted,
              // so a subsequent interactive run will retry the same forceRefresh.
              // This is acceptable because computeVerificationDiffs is only
              // triggered by admin actions (not scheduled jobs).
              logger.warn(`   ⚠️ Force-refresh failed for deployment ${row.id}, using cache-only result`, {
                error: err instanceof Error ? err.message : String(err),
                stack_trace: err instanceof Error ? err.stack : undefined,
              })
              precomputedResult = cacheOnlyResult
            }
          } else {
            // No diff detected and no missing PR snapshot — reuse cache-only result
            // to avoid redundant verifyDeployment() call after the if/else block.
            precomputedResult = cacheOnlyResult
          }
        }
      } else {
        // No compare snapshot — fetch fresh data from GitHub (will be cached for future use)
        logger.info(`   🌐 Fetching fresh data for deployment ${row.id} (no compare snapshot)`)
        input = await fetchVerificationData(
          row.id,
          row.commit_sha,
          `${owner}/${repo}`,
          row.environment_name,
          baseBranch,
          monitoredAppId,
        )
      }

      const newResult = precomputedResult ?? verifyDeployment(input)

      const normalizedOldStatus = normalizeStatus(row.four_eyes_status)
      const normalizedNewStatus = normalizeStatus(newResult.status)
      const statusDifferent = normalizedOldStatus !== normalizedNewStatus

      if (statusDifferent) {
        diffs.push({
          deploymentId: row.id,
          oldStatus: row.four_eyes_status,
          newStatus: newResult.status,
          errorReason: newResult.status === 'error' ? newResult.approvalDetails.reason : null,
        })
      }

      result.deploymentsChecked++
      await options.onProgress?.(result.deploymentsChecked, deployments.length, diffs.length)
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
           (monitored_app_id, deployment_id, old_status, new_status, error_reason, computed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [monitoredAppId, diff.deploymentId, diff.oldStatus, diff.newStatus, diff.errorReason],
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
