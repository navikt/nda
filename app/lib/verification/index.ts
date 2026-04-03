/**
 * Verification System
 *
 * This is the main entry point for the new verification system.
 * It orchestrates: Fetch → Store → Verify → Save Result
 *
 * Usage:
 * ```typescript
 * import { runVerification } from '~/lib/verification'
 *
 * const result = await runVerification(deploymentId, {
 *   commitSha: 'abc123',
 *   repository: 'owner/repo',
 *   environmentName: 'prod',
 *   baseBranch: 'main',
 *   monitoredAppId: 42,
 * })
 * ```
 */

import { getImplicitApprovalSettings } from '~/db/app-settings.server'
import { propagateVerificationToSiblings } from '~/db/application-groups.server'
import { pool } from '~/db/connection.server'
import {
  getCompareSnapshotForCommit,
  getPreviousDeploymentForDiff,
  getPrSnapshotsForDiff,
} from '~/db/verification-diff.server'
import { logger } from '~/lib/logger.server'
import { buildCommitsBetweenFromCache, fetchVerificationData } from './fetch-data.server'
import { storeVerificationResult } from './store-data.server'
import type { CompareData, PrCommit, PrMetadata, PrReview, VerificationInput, VerificationResult } from './types'
import { verifyDeployment } from './verify'

// Re-export individual modules
export { fetchVerificationDataForAllDeployments } from './fetch-data.server'

// Re-export types and constants for convenience
export type {
  VerificationInput,
  VerificationResult,
} from './types'

// =============================================================================
// Debug Mode
// =============================================================================

/**
 * Check if verification debug mode is enabled.
 * Set VERIFICATION_DEBUG=true to enable.
 */
export const isVerificationDebugMode = process.env.VERIFICATION_DEBUG === 'true'

// =============================================================================
// Main Verification Function
// =============================================================================

interface RunVerificationOptions {
  commitSha: string
  repository: string
  environmentName: string
  baseBranch: string
  monitoredAppId: number
  forceRefresh?: boolean
}

/**
 * Run the complete verification flow for a deployment.
 *
 * Flow:
 * 1. Fetch all data needed (from cache or GitHub)
 * 2. Store fetched data to database
 * 3. Run stateless verification
 * 4. Store verification result
 *
 * @param deploymentId - The deployment ID to verify
 * @param options - Verification options
 * @returns The verification result
 */
export async function runVerification(
  deploymentId: number,
  options: RunVerificationOptions,
): Promise<VerificationResult> {
  logger.info(`🔍 Starting verification for deployment ${deploymentId}`)

  // Step 1: Fetch all data needed for verification
  logger.info(`   📥 Fetching data from GitHub/cache...`)
  const input = await fetchVerificationData(
    deploymentId,
    options.commitSha,
    options.repository,
    options.environmentName,
    options.baseBranch,
    options.monitoredAppId,
    { forceRefresh: options.forceRefresh },
  )

  logger.info(`   ✅ Data fetched:`)
  logger.info(`      - Deployed PR: ${input.deployedPr?.number || 'none'}`)
  logger.info(`      - Commits between: ${input.commitsBetween.length}`)
  logger.info(`      - Previous deployment: ${input.previousDeployment?.id || 'none'}`)

  // Step 2: Run stateless verification
  logger.info(`   🧪 Running verification logic...`)
  const result = verifyDeployment(input)

  logger.info(`   ✅ Verification complete:`)
  logger.info(`      - Status: ${result.status}`)
  logger.info(`      - Four eyes: ${result.hasFourEyes}`)
  logger.info(`      - Unverified commits: ${result.unverifiedCommits.length}`)

  // Step 3: Store the result
  logger.info(`   💾 Storing verification result...`)

  // Collect snapshot IDs from the fetched data
  // In a full implementation, fetchVerificationData would return these
  const snapshotIds = {
    prSnapshotIds: [], // Would be populated by fetch-data
    commitSnapshotIds: [], // Would be populated by fetch-data
  }

  const { verificationRunId } = await storeVerificationResult(deploymentId, result, snapshotIds, undefined, {
    repository: options.repository,
    commitsBetween: input.commitsBetween,
  })

  // Step 4: Propagate to sibling deployments in the same application group
  const propagated = await propagateVerificationToSiblings(
    deploymentId,
    result.status,
    options.commitSha,
    options.monitoredAppId,
  )
  if (propagated > 0) {
    logger.info(`   🔗 Propagated verification to ${propagated} sibling deployment(s)`)
  }

  logger.info(`   ✅ Stored as verification run #${verificationRunId}`)
  logger.info(`🎉 Verification complete for deployment ${deploymentId}`)

  return result
}

// =============================================================================
// Debug Verification (does NOT store result to deployment)
// =============================================================================

/**
 * Existing verification status from the deployment table
 */
export interface ExistingVerificationStatus {
  hasFourEyes: boolean | null
  status: string | null
  prNumber: number | null
  prUrl: string | null
  prData: unknown
  unverifiedCommits: unknown[]
}

/**
 * Result from debug verification - includes all data for comparison
 */
export interface DebugVerificationResult {
  existingStatus: ExistingVerificationStatus
  fetchedData: VerificationInput
  newResult: VerificationResult
  comparison: {
    statusChanged: boolean
    hasFourEyesChanged: boolean
    oldStatus: string | null
    newStatus: string
    oldHasFourEyes: boolean | null
    newHasFourEyes: boolean
    statusEquivalent: boolean // True if statuses differ in name only
  }
}

/**
 * Run verification in debug mode.
 *
 * This fetches data from GitHub (storing snapshots), runs verification,
 * but does NOT update the deployment record. Used for comparing V1 vs V2.
 */
export async function runDebugVerification(
  deploymentId: number,
  options: RunVerificationOptions,
): Promise<DebugVerificationResult> {
  logger.info(`🔬 [DEBUG] Starting debug verification for deployment ${deploymentId}`)

  // Step 1: Get existing status from deployment
  const existingStatus = await getExistingVerificationStatus(deploymentId)
  logger.info(`   📋 Existing status: ${existingStatus.status} (four_eyes: ${existingStatus.hasFourEyes})`)

  // Step 2: Fetch data from GitHub (this stores to snapshots table)
  const useCache = options.forceRefresh === false
  logger.info(`   📥 Fetching data${useCache ? ' (using cache if available)' : ' from GitHub'}...`)
  const fetchedData = await fetchVerificationData(
    deploymentId,
    options.commitSha,
    options.repository,
    options.environmentName,
    options.baseBranch,
    options.monitoredAppId,
    { forceRefresh: !useCache },
  )

  logger.info(`   ✅ Data fetched:`)
  logger.info(`      - Deployed PR: ${fetchedData.deployedPr?.number || 'none'}`)
  logger.info(`      - Commits between: ${fetchedData.commitsBetween.length}`)

  // Step 3: Run verification (but don't store result)
  logger.info(`   🧪 Running verification logic...`)
  const newResult = verifyDeployment(fetchedData)

  logger.info(`   ✅ New verification result:`)
  logger.info(`      - Status: ${newResult.status}`)
  logger.info(`      - Four eyes: ${newResult.hasFourEyes}`)

  // Step 4: Build comparison
  // Normalize equivalent statuses for comparison
  const normalizeStatus = (status: string | null): string | null => {
    if (!status) return status
    // These status pairs are semantically equivalent
    const equivalentStatuses: Record<string, string> = {
      approved_pr: 'approved',
      pending_approval: 'pending',
    }
    return equivalentStatuses[status] || status
  }

  const normalizedOldStatus = normalizeStatus(existingStatus.status)
  const normalizedNewStatus = normalizeStatus(newResult.status)
  const statusEquivalent = existingStatus.status !== newResult.status && normalizedOldStatus === normalizedNewStatus

  const comparison = {
    statusChanged: normalizedOldStatus !== normalizedNewStatus,
    hasFourEyesChanged: existingStatus.hasFourEyes !== newResult.hasFourEyes,
    oldStatus: existingStatus.status,
    newStatus: newResult.status,
    oldHasFourEyes: existingStatus.hasFourEyes,
    newHasFourEyes: newResult.hasFourEyes,
    statusEquivalent, // True if statuses differ in name only, not meaning
  }

  if (comparison.statusChanged || comparison.hasFourEyesChanged) {
    logger.info(`   ⚠️  DIFFERENCE DETECTED:`)
    if (comparison.statusChanged) {
      logger.info(`      Status: ${comparison.oldStatus} → ${comparison.newStatus}`)
    }
    if (comparison.hasFourEyesChanged) {
      logger.info(`      Four eyes: ${comparison.oldHasFourEyes} → ${comparison.newHasFourEyes}`)
    }
  } else {
    logger.info(`   ✅ No difference - results match`)
  }

  logger.info(`🔬 [DEBUG] Debug verification complete (result NOT saved)`)

  return {
    existingStatus,
    fetchedData,
    newResult,
    comparison,
  }
}

/**
 * Get the existing verification status from the deployment table
 */
async function getExistingVerificationStatus(deploymentId: number): Promise<ExistingVerificationStatus> {
  const result = await pool.query(
    `SELECT 
       has_four_eyes,
       four_eyes_status,
       github_pr_number,
       github_pr_url,
       github_pr_data,
       unverified_commits
     FROM deployments
     WHERE id = $1`,
    [deploymentId],
  )

  if (result.rows.length === 0) {
    return {
      hasFourEyes: null,
      status: null,
      prNumber: null,
      prUrl: null,
      prData: null,
      unverifiedCommits: [],
    }
  }

  const row = result.rows[0]
  return {
    hasFourEyes: row.has_four_eyes,
    status: row.four_eyes_status,
    prNumber: row.github_pr_number,
    prUrl: row.github_pr_url,
    prData: row.github_pr_data,
    unverifiedCommits: row.unverified_commits || [],
  }
}

// =============================================================================
// Reverification
// =============================================================================

/**
 * Re-run verification for a single deployment using cached GitHub data,
 * and apply the new result to the database.
 *
 * Returns the comparison, or null if the deployment was skipped (no data,
 * manually_approved, or legacy).
 */
export async function reverifyDeployment(deploymentId: number): Promise<{
  changed: boolean
  oldStatus: string | null
  newStatus: string
  oldHasFourEyes: boolean | null
  newHasFourEyes: boolean
} | null> {
  // Get deployment with app context
  const row = await pool.query(
    `SELECT
       d.id, d.commit_sha, d.four_eyes_status, d.has_four_eyes,
       d.github_pr_number, d.environment_name, d.monitored_app_id,
       d.detected_github_owner, d.detected_github_repo_name,
       ma.default_branch, ma.audit_start_year
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.id = $1`,
    [deploymentId],
  )

  if (row.rows.length === 0) {
    throw new Error(`Deployment ${deploymentId} not found`)
  }

  const dep = row.rows[0]

  // Skip manually approved or legacy
  if (dep.four_eyes_status === 'manually_approved' || dep.four_eyes_status === 'legacy') {
    return null
  }

  const implicitApprovalSettings = await getImplicitApprovalSettings(dep.monitored_app_id)

  const compareSnapshot = await getCompareSnapshotForCommit(dep.commit_sha)
  if (!compareSnapshot) return null

  const compareData = compareSnapshot.data as CompareData
  const owner = dep.detected_github_owner
  const repo = dep.detected_github_repo_name
  const baseBranch = dep.default_branch || 'main'

  const prevRow = await getPreviousDeploymentForDiff(dep.id, dep.environment_name)
  const previousDeployment = prevRow
    ? { id: prevRow.id, commitSha: prevRow.commit_sha, createdAt: prevRow.created_at.toISOString() }
    : null

  const commitsBetween = await buildCommitsBetweenFromCache(owner, repo, baseBranch, compareData, {
    cacheOnly: true,
  })

  let deployedPr: VerificationInput['deployedPr'] = null
  if (dep.github_pr_number) {
    const snapshotMap = await getPrSnapshotsForDiff(dep.github_pr_number)
    if (snapshotMap.has('metadata') && snapshotMap.has('reviews') && snapshotMap.has('commits')) {
      deployedPr = {
        number: dep.github_pr_number,
        url: `https://github.com/${owner}/${repo}/pull/${dep.github_pr_number}`,
        metadata: snapshotMap.get('metadata') as PrMetadata,
        reviews: snapshotMap.get('reviews') as PrReview[],
        commits: snapshotMap.get('commits') as PrCommit[],
      }
    }
  }

  const input: VerificationInput = {
    deploymentId: dep.id,
    commitSha: dep.commit_sha,
    repository: `${owner}/${repo}`,
    environmentName: dep.environment_name,
    baseBranch,
    auditStartYear: dep.audit_start_year,
    implicitApprovalSettings: implicitApprovalSettings ?? { mode: 'off' },
    previousDeployment,
    deployedPr,
    commitsBetween,
    dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
    repositoryStatus: 'active',
    commitOnBaseBranch: null,
  }

  const newResult = verifyDeployment(input)

  const statusChanged = dep.four_eyes_status !== newResult.status
  const fourEyesChanged = dep.has_four_eyes !== newResult.hasFourEyes
  const changed = statusChanged || fourEyesChanged

  if (changed) {
    await storeVerificationResult(dep.id, newResult, { prSnapshotIds: [], commitSnapshotIds: [] }, 'reverification')

    // Propagate to sibling deployments in the same application group
    await propagateVerificationToSiblings(dep.id, newResult.status, dep.commit_sha, dep.monitored_app_id)
  }

  return {
    changed,
    oldStatus: dep.four_eyes_status,
    newStatus: newResult.status,
    oldHasFourEyes: dep.has_four_eyes,
    newHasFourEyes: newResult.hasFourEyes,
  }
}
