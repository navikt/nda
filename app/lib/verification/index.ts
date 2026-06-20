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
import { getMergedPullRequestsInWindow } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { analyzeMergedPrWindow } from './debug-merged-prs'
import { buildCommitsBetweenFromCache, fetchVerificationData } from './fetch-data.server'
import { storeVerificationResult, updateDeploymentVerification } from './store-data.server'
import type { CompareData, PrCommit, PrMetadata, PrReview, VerificationInput, VerificationResult } from './types'
import { verifyDeployment } from './verify'

export { fetchVerificationDataForAllDeployments } from './fetch-data.server'

export type {
  VerificationInput,
  VerificationResult,
} from './types'

export const isVerificationDebugMode = process.env.VERIFICATION_DEBUG === 'true'

function applyPassthroughFields(result: VerificationResult, input: VerificationInput): void {
  if (input.branchMismatch) {
    result.branchMismatch = input.branchMismatch
  }
  if (input.detectedBranchName) {
    result.detectedBranchName = input.detectedBranchName
  }
  if (input.detectedTitle) {
    result.detectedTitle = input.detectedTitle
  }
}

function deriveDetectedTitle(
  deployedPr: VerificationInput['deployedPr'],
  commitsBetween: VerificationInput['commitsBetween'],
): string | undefined {
  if (deployedPr) return undefined
  const raw = commitsBetween[0]?.message
  if (!raw) return undefined
  return raw.split('\n')[0].trim().slice(0, 500) || undefined
}

interface RunVerificationOptions {
  commitSha: string
  repository: string
  environmentName: string
  baseBranch: string
  monitoredAppId: number
  forceRefresh?: boolean
  triggerUrl?: string | null
}

export async function runVerification(
  deploymentId: number,
  options: RunVerificationOptions,
): Promise<VerificationResult> {
  logger.info(`🔍 Starting verification for deployment ${deploymentId}`)

  logger.info(`   📥 Fetching data from GitHub/cache...`)
  const input = await fetchVerificationData(
    deploymentId,
    options.commitSha,
    options.repository,
    options.environmentName,
    options.baseBranch,
    options.monitoredAppId,
    { forceRefresh: options.forceRefresh },
    options.triggerUrl,
  )

  logger.info(`   ✅ Data fetched:`)
  logger.info(`      - Deployed PR: ${input.deployedPr?.number || 'none'}`)
  logger.info(`      - Commits between: ${input.commitsBetween.length}`)
  logger.info(`      - Previous deployment: ${input.previousDeployment?.id || 'none'}`)

  logger.info(`   🧪 Running verification logic...`)
  const result = verifyDeployment(input)
  applyPassthroughFields(result, input)

  logger.info(`   ✅ Verification complete:`)
  logger.info(`      - Status: ${result.status}`)
  logger.info(`      - Unverified commits: ${result.unverifiedCommits.length}`)

  logger.info(`   💾 Storing verification result...`)

  const snapshotIds = {
    prSnapshotIds: [], // Would be populated by fetch-data
    commitSnapshotIds: [], // Would be populated by fetch-data
  }

  const { verificationRunId } = await storeVerificationResult(deploymentId, result, snapshotIds, undefined, {
    repository: options.repository,
    commitsBetween: input.commitsBetween,
  })

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

export interface ExistingVerificationStatus {
  status: string | null
  prNumber: number | null
  prUrl: string | null
  prData: unknown
  unverifiedCommits: unknown[]
}

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
  mergedPullRequestsWindow: {
    windowStart: string
    windowEnd: string
    summary: {
      totalMergedPrs: number
      deliveredAsCurrentPr: number
      deliveredAsNearbyPr: number
      deliveredByCommitSha: number
      notObservedInDeployments: number
    }
    pullRequests: Array<{
      number: number
      title: string
      htmlUrl: string
      mergedAt: string
      baseBranch: string
      headSha: string
      mergeCommitSha: string | null
      authorUsername: string | null
      mergedByUsername: string | null
      classification:
        | 'deployed_as_current_pr'
        | 'deployed_as_nearby_pr'
        | 'deployed_by_commit_sha'
        | 'not_observed_in_deployments'
      matchedDeploymentIds: number[]
    }>
    fetchError: string | null
  }
  newResult: VerificationResult
  comparison: {
    statusChanged: boolean
    oldStatus: string | null
    newStatus: string
    statusEquivalent: boolean
  }
}

export async function runDebugVerification(
  deploymentId: number,
  options: RunVerificationOptions,
): Promise<DebugVerificationResult> {
  logger.info(`🔬 [DEBUG] Starting debug verification for deployment ${deploymentId}`)

  const existingStatus = await getExistingVerificationStatus(deploymentId)
  logger.info(`   📋 Existing status: ${existingStatus.status}`)

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

  logger.info(`   🧪 Running verification logic...`)
  const newResult = verifyDeployment(fetchedData)

  logger.info(`   ✅ New verification result:`)
  logger.info(`      - Status: ${newResult.status}`)

  const normalizeStatus = (status: string | null): string | null => {
    if (!status) return status
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
  const mergedPullRequestsWindow = await getMergedPullRequestsWindowDebugData(
    deploymentId,
    options,
    fetchedData,
    nearbyDeployments,
  )

  return {
    existingStatus,
    fetchedData,
    nearbyDeployments,
    mergedPullRequestsWindow,
    newResult,
    comparison,
  }
}

async function getMergedPullRequestsWindowDebugData(
  deploymentId: number,
  options: RunVerificationOptions,
  fetchedData: VerificationInput,
  nearbyDeployments: DebugVerificationResult['nearbyDeployments'],
): Promise<DebugVerificationResult['mergedPullRequestsWindow']> {
  const deploymentCreatedAt = await getDeploymentCreatedAt(deploymentId)
  if (!deploymentCreatedAt) {
    return {
      windowStart: '',
      windowEnd: '',
      summary: {
        totalMergedPrs: 0,
        deliveredAsCurrentPr: 0,
        deliveredAsNearbyPr: 0,
        deliveredByCommitSha: 0,
        notObservedInDeployments: 0,
      },
      pullRequests: [],
      fetchError: `Fant ikke deployment #${deploymentId}`,
    }
  }

  const [owner, repo] = options.repository.split('/')
  if (!owner || !repo) {
    return {
      windowStart: '',
      windowEnd: '',
      summary: {
        totalMergedPrs: 0,
        deliveredAsCurrentPr: 0,
        deliveredAsNearbyPr: 0,
        deliveredByCommitSha: 0,
        notObservedInDeployments: 0,
      },
      pullRequests: [],
      fetchError: `Ugyldig repository-format: ${options.repository}`,
    }
  }

  const windowStartDate = new Date(deploymentCreatedAt.getTime() - 30 * 60 * 1000)
  const windowEndDate = new Date(deploymentCreatedAt.getTime() + 30 * 60 * 1000)
  const windowStart = windowStartDate.toISOString()
  const windowEnd = windowEndDate.toISOString()

  try {
    const mergedPullRequests = await getMergedPullRequestsInWindow(
      owner,
      repo,
      options.baseBranch,
      windowStart,
      windowEnd,
    )

    const analysis = analyzeMergedPrWindow(
      mergedPullRequests,
      {
        deploymentId,
        commitSha: options.commitSha,
        githubPrNumber: fetchedData.deployedPr?.number ?? null,
      },
      nearbyDeployments.map((deployment) => ({
        deploymentId: deployment.id,
        commitSha: deployment.commitSha,
        githubPrNumber: deployment.githubPrNumber,
      })),
    )

    return {
      windowStart,
      windowEnd,
      summary: analysis.summary,
      pullRequests: analysis.pullRequests,
      fetchError: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ukjent feil ved henting av merged PR-er'
    logger.warn(`runDebugVerification(${deploymentId}): could not fetch merged PR window: ${message}`)

    return {
      windowStart,
      windowEnd,
      summary: {
        totalMergedPrs: 0,
        deliveredAsCurrentPr: 0,
        deliveredAsNearbyPr: 0,
        deliveredByCommitSha: 0,
        notObservedInDeployments: 0,
      },
      pullRequests: [],
      fetchError: message,
    }
  }
}

async function getNearbyDeploymentsDebugData(
  deploymentId: number,
): Promise<DebugVerificationResult['nearbyDeployments']> {
  const result = await pool.query(
    `WITH reference_deployment AS (
       SELECT monitored_app_id, created_at
       FROM deployments
       WHERE id = $1
     )
     SELECT 
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
     CROSS JOIN reference_deployment ref
     WHERE d.monitored_app_id = ref.monitored_app_id
       AND d.id != $1
       AND d.created_at BETWEEN (
         ref.created_at - interval '30 minutes'
       ) AND (
         ref.created_at + interval '30 minutes'
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

async function getDeploymentCreatedAt(deploymentId: number): Promise<Date | null> {
  const result = await pool.query(
    `SELECT created_at
     FROM deployments
     WHERE id = $1`,
    [deploymentId],
  )

  if (result.rows.length === 0) return null
  return result.rows[0].created_at as Date
}

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

export async function reverifyDeployment(deploymentId: number): Promise<{
  changed: boolean
  oldStatus: string | null
  newStatus: string
} | null> {
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

  if (isProtectedStatus(dep.four_eyes_status ?? '')) {
    return null
  }

  const implicitApprovalSettings = await getImplicitApprovalSettings(dep.monitored_app_id)

  const compareSnapshot = await getCompareSnapshotForCommit(dep.commit_sha)
  if (!compareSnapshot) return null

  const owner = dep.detected_github_owner
  const repo = dep.detected_github_repo_name
  if (!dep.default_branch) return null
  const baseBranch = dep.default_branch

  const prevRow = await getPreviousDeploymentForDiff(dep.id, dep.environment_name)
  const previousDeployment = prevRow
    ? { id: prevRow.id, commitSha: prevRow.commit_sha, createdAt: prevRow.created_at.toISOString() }
    : null

  let input: VerificationInput
  const cacheBaseMismatch = previousDeployment && compareSnapshot.base_sha !== previousDeployment.commitSha
  if (cacheBaseMismatch) {
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
      detectedTitle: deriveDetectedTitle(deployedPr, commitsBetween),
    }
  }

  const newResult = verifyDeployment(input)
  applyPassthroughFields(newResult, input)

  const statusChanged = dep.four_eyes_status !== newResult.status

  if (statusChanged) {
    await storeVerificationResult(dep.id, newResult, { prSnapshotIds: [], commitSnapshotIds: [] }, 'reverification')
    await propagateVerificationToSiblings(dep.id, newResult.status, dep.commit_sha, dep.monitored_app_id)
  } else {
    await updateDeploymentVerification(dep.id, newResult, 'reverification')
  }

  return {
    changed: statusChanged,
    oldStatus: dep.four_eyes_status,
    newStatus: newResult.status,
  }
}
