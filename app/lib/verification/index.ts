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
import { TITLE_COALESCE_SQL } from '~/db/deployments.server'
import {
  getCompareSnapshotForCommit,
  getPreviousDeploymentForDiff,
  getPrSnapshotsForDiff,
} from '~/db/verification-diff.server'
import { isProtectedStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { buildCommitsBetweenFromCache, fetchVerificationData } from './fetch-data.server'
import { storeVerificationResult, updateDeploymentVerification } from './store-data.server'
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

  // Passthrough: branchMismatch is a data-fetch artifact, not a verify decision.
  // Surface it on the result so it gets persisted in verification_runs.result
  // and is available to UI consumers.
  if (input.branchMismatch) {
    result.branchMismatch = input.branchMismatch
  }

  logger.info(`   ✅ Verification complete:`)
  logger.info(`      - Status: ${result.status}`)
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
  nearbyDeployments: Array<{
    id: number
    commitSha: string | null
    createdAt: string
    fourEyesStatus: string | null
    deployerUsername: string | null
    githubPrNumber: number | null
    githubPrUrl: string | null
    githubPrData: unknown
    unverifiedCommits: unknown
    title: string | null
    naisDeploymentId: string | null
    environmentName: string
    detectedGithubOwner: string | null
    detectedGithubRepoName: string | null
    verificationRun: {
      status: string
      runAt: string
      schemaVersion: number
      result: unknown
    } | null
  }>
  newResult: VerificationResult
  comparison: {
    statusChanged: boolean
    oldStatus: string | null
    newStatus: string
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
  logger.info(`   📋 Existing status: ${existingStatus.status}`)

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
    oldStatus: existingStatus.status,
    newStatus: newResult.status,
    statusEquivalent,
  }

  if (comparison.statusChanged) {
    logger.info(`   ⚠️  DIFFERENCE DETECTED:`)
    logger.info(`      Status: ${comparison.oldStatus} → ${comparison.newStatus}`)
  } else {
    logger.info(`   ✅ No difference - results match`)
  }

  logger.info(`🔬 [DEBUG] Debug verification complete (result NOT saved)`)

  const nearbyDeployments = await getNearbyDeploymentsDebugData(deploymentId)

  return {
    existingStatus,
    fetchedData,
    nearbyDeployments,
    newResult,
    comparison,
  }
}

async function getNearbyDeploymentsDebugData(
  deploymentId: number,
): Promise<DebugVerificationResult['nearbyDeployments']> {
  const result = await pool.query(
    `SELECT 
       d.id,
       d.commit_sha,
       d.created_at,
       d.four_eyes_status,
       d.deployer_username,
       d.github_pr_number,
       d.github_pr_url,
       d.github_pr_data,
       d.unverified_commits,
       ${TITLE_COALESCE_SQL} AS title,
       d.nais_deployment_id,
       d.environment_name,
       d.detected_github_owner,
       d.detected_github_repo_name,
       vr.status AS verification_status,
       vr.run_at AS verification_run_at,
       vr.schema_version AS verification_schema_version,
       vr.result AS verification_result
     FROM deployments d
     LEFT JOIN commits c ON c.sha = d.commit_sha
       AND c.repo_owner = d.detected_github_owner
       AND c.repo_name = d.detected_github_repo_name
     LEFT JOIN LATERAL (
       SELECT status, run_at, schema_version, result
       FROM verification_runs
       WHERE deployment_id = d.id
       ORDER BY run_at DESC
       LIMIT 1
     ) vr ON true
     WHERE d.monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
       AND d.id != $1
       AND d.created_at BETWEEN (
         (SELECT created_at FROM deployments WHERE id = $1) - interval '30 minutes'
       ) AND (
         (SELECT created_at FROM deployments WHERE id = $1) + interval '30 minutes'
       )
     ORDER BY d.created_at`,
    [deploymentId],
  )

  return result.rows.map((row) => ({
    id: row.id as number,
    commitSha: (row.commit_sha as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    fourEyesStatus: (row.four_eyes_status as string | null) ?? null,
    deployerUsername: (row.deployer_username as string | null) ?? null,
    githubPrNumber: (row.github_pr_number as number | null) ?? null,
    githubPrUrl: (row.github_pr_url as string | null) ?? null,
    githubPrData: row.github_pr_data as unknown,
    unverifiedCommits: row.unverified_commits as unknown,
    title: (row.title as string | null) ?? null,
    naisDeploymentId: (row.nais_deployment_id as string | null) ?? null,
    environmentName: row.environment_name as string,
    detectedGithubOwner: (row.detected_github_owner as string | null) ?? null,
    detectedGithubRepoName: (row.detected_github_repo_name as string | null) ?? null,
    verificationRun: row.verification_status
      ? {
          status: row.verification_status as string,
          runAt: (row.verification_run_at as Date).toISOString(),
          schemaVersion: row.verification_schema_version as number,
          result: row.verification_result as unknown,
        }
      : null,
  }))
}

/**
 * Get the existing verification status from the deployment table
 */
async function getExistingVerificationStatus(deploymentId: number): Promise<ExistingVerificationStatus> {
  const result = await pool.query(
    `SELECT 
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
      status: null,
      prNumber: null,
      prUrl: null,
      prData: null,
      unverifiedCommits: [],
    }
  }

  const row = result.rows[0]
  return {
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
 * Returns the comparison, or null if the deployment was skipped:
 *   - missing GitHub compare snapshot
 *   - `manually_approved` (admin action — V2 cannot reproduce)
 *   - `baseline` (admin action — V2 cannot reproduce)
 *   - `legacy` (pre-audit historic data)
 */
export async function reverifyDeployment(deploymentId: number): Promise<{
  changed: boolean
  oldStatus: string | null
  newStatus: string
} | null> {
  // Get deployment with app context
  const row = await pool.query(
    `SELECT
       d.id, d.commit_sha, d.four_eyes_status,
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

  // Skip protected statuses (manually approved, baseline, legacy)
  if (isProtectedStatus(dep.four_eyes_status ?? '')) {
    return null
  }

  const implicitApprovalSettings = await getImplicitApprovalSettings(dep.monitored_app_id)

  const compareSnapshot = await getCompareSnapshotForCommit(dep.commit_sha)
  if (!compareSnapshot) return null

  const owner = dep.detected_github_owner
  const repo = dep.detected_github_repo_name
  const baseBranch = dep.default_branch || 'main'

  const prevRow = await getPreviousDeploymentForDiff(dep.id, dep.environment_name)
  const previousDeployment = prevRow
    ? { id: prevRow.id, commitSha: prevRow.commit_sha, createdAt: prevRow.created_at.toISOString() }
    : null

  let input: VerificationInput
  const cacheBaseMismatch = previousDeployment && compareSnapshot.base_sha !== previousDeployment.commitSha
  if (cacheBaseMismatch) {
    // Snapshot lookup is by head_sha only; a base mismatch means cache is for
    // another deployment range and must not be reused.
    logger.warn(
      `reverifyDeployment(${dep.id}): cache snapshot base_sha ${compareSnapshot.base_sha} ≠ previousDeployment ${previousDeployment.commitSha} — refetching`,
    )
    input = await fetchVerificationData(
      dep.id,
      dep.commit_sha,
      `${owner}/${repo}`,
      dep.environment_name,
      baseBranch,
      dep.monitored_app_id,
      { forceRefresh: true },
    )
  } else {
    const compareData = compareSnapshot.data as CompareData
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

    // Guard against missing compare metadata (v3 snapshots only have 'commits')
    const hasCompareMetadata = compareData.compare !== undefined
    input = {
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
      compareSummary: hasCompareMetadata ? compareData.compare : null,
      dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
      repositoryStatus: 'active',
      commitOnBaseBranch: null,
    }
  }

  const newResult = verifyDeployment(input)

  const statusChanged = dep.four_eyes_status !== newResult.status

  if (statusChanged) {
    // Full store: save verification run history + update deployment record
    await storeVerificationResult(dep.id, newResult, { prSnapshotIds: [], commitSnapshotIds: [] }, 'reverification')
    // Propagate to sibling deployments in the same application group
    await propagateVerificationToSiblings(dep.id, newResult.status, dep.commit_sha, dep.monitored_app_id)
  } else {
    // Metadata-only update: refresh title, PR data, unverified commits without creating history rows
    await updateDeploymentVerification(dep.id, newResult, 'reverification')
  }

  return {
    changed: statusChanged,
    oldStatus: dep.four_eyes_status,
    newStatus: newResult.status,
  }
}
