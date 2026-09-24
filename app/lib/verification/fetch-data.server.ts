import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { getEffectiveSettingsForApp, getEffectiveSettingsForRepository } from '~/db/repositories.server'
import { APPROVED_STATUSES_SQL } from '~/lib/four-eyes-status'
import { getSingleCommitMessage, isCommitOnBranch, resolveWorkflowRunDetails } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { buildBranchMismatch } from './branch-mismatch'
import { fetchCommitChecks, getCachedCommitChecks } from './fetch-data/commit-checks.server'
import { fetchCommitsBetween } from './fetch-data/commits-between.server'
import { type FetchOptions, fetchDeployedPrData } from './fetch-data/pr-data.server'
import { getPreviousDeployment, preferRootApprovedSibling } from './fetch-data/previous-deployment.server'
import { fetchWorkflowTriggerConfig } from './fetch-data/workflow-triggers.server'
import type { RepositoryStatus } from './types'
import {
  type CompareSummary,
  CURRENT_SCHEMA_VERSION,
  type ImplicitApprovalSettings,
  type VerificationInput,
} from './types'

export async function fetchVerificationData(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  baseBranch: string,
  monitoredAppId: number,
  options?: FetchOptions,
  triggerUrl?: string | null,
  repositoryId?: number,
): Promise<VerificationInput> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid repository format: ${repository}`)
  }

  const appSettings =
    repositoryId != null
      ? await getEffectiveSettingsForRepository(repositoryId, monitoredAppId)
      : await getAppSettings(monitoredAppId)

  const repoCheck = await findRepositoryForApp(monitoredAppId, owner, repo)
  const repositoryStatus: RepositoryStatus = repoCheck.repository
    ? (repoCheck.repository.status as RepositoryStatus)
    : 'unknown'
  const githubRepoId = repoCheck.repository?.github_repo_id ?? null

  const { rows: ownIdRows } = await pool.query<{ github_repo_id: string | null }>(
    `SELECT github_repo_id FROM deployments WHERE id = $1`,
    [deploymentId],
  )
  const ownGithubRepoId = ownIdRows[0]?.github_repo_id ?? null
  if (ownGithubRepoId != null && (githubRepoId == null || ownGithubRepoId !== githubRepoId)) {
    logger.warn(
      `fetchVerificationData(${deploymentId}): deployment's own github_repo_id ${ownGithubRepoId} does not match currently linked repository ${owner}/${repo} (${githubRepoId ?? 'none'}) — name likely reused; aborting to avoid mixing data across repositories`,
    )
    throw new Error(
      `Deployment ${deploymentId}: github_repo_id ${ownGithubRepoId} does not match currently linked repository ${owner}/${repo}`,
    )
  }

  const commitOnBaseBranch = await isCommitOnBranch(owner, repo, commitSha, baseBranch)

  const previousDeploymentResult = await getPreviousDeployment(
    deploymentId,
    owner,
    repo,
    githubRepoId,
    appSettings.auditStartYear,
    commitSha,
  )
  const previousDeploymentRateLimited = previousDeploymentResult === 'rate_limited'
  const previousDeployment = previousDeploymentRateLimited
    ? null
    : await preferRootApprovedSibling(previousDeploymentResult, commitSha, githubRepoId, monitoredAppId, deploymentId)
  const previousDeploymentLookupFailed =
    (repositoryStatus === 'active' && !githubRepoId) || previousDeploymentRateLimited

  const deployedPrResult = await fetchDeployedPrData(owner, repo, commitSha, baseBranch, options)
  const deployedPr = deployedPrResult.deployedPr

  let commitsBetween: VerificationInput['commitsBetween'] = []
  let compareSummary: CompareSummary | null = null
  let compareFailed = false
  let compareDerivedFromRaw = false
  if (previousDeployment) {
    const result = await fetchCommitsBetween(
      owner,
      repo,
      previousDeployment.commitSha,
      commitSha,
      baseBranch,
      previousDeployment.createdAt,
      options,
    )
    if (result === null) {
      compareFailed = true
    } else {
      commitsBetween = result.commitsBetween
      compareSummary = result.compareSummary
      compareDerivedFromRaw = result.derivedFromRaw
    }
  }
  const noDiffAlreadyConfirmed = compareSummary?.noDiffDetected === true

  const branchMismatch = buildBranchMismatch(
    deployedPr,
    deployedPrResult.mismatchedBaseBranches,
    deployedPrResult.mismatchedPrNumbers,
    commitsBetween,
    baseBranch,
  )

  let nearbyApprovedDeployWithSameCommit: VerificationInput['nearbyApprovedDeployWithSameCommit']
  if (
    previousDeployment &&
    commitsBetween.length === 0 &&
    !compareFailed &&
    commitSha !== previousDeployment.commitSha &&
    !noDiffAlreadyConfirmed
  ) {
    const nearbyResult = await pool.query(
      `SELECT d.id, d.four_eyes_status
       FROM deployments d
       WHERE d.monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
         AND d.detected_github_owner = $3
         AND d.detected_github_repo_name = $4
         AND d.id != $1
         AND d.commit_sha = $2
         AND d.four_eyes_status IN (${APPROVED_STATUSES_SQL})
         AND d.created_at BETWEEN (
           (SELECT created_at FROM deployments WHERE id = $1) - interval '30 minutes'
         ) AND (
           (SELECT created_at FROM deployments WHERE id = $1) + interval '30 minutes'
         )
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [deploymentId, commitSha, owner, repo],
    )
    if (nearbyResult.rows.length > 0) {
      nearbyApprovedDeployWithSameCommit = {
        deploymentId: nearbyResult.rows[0].id,
        status: nearbyResult.rows[0].four_eyes_status,
      }
    }
  }

  let nearbyApprovedDeploy: VerificationInput['nearbyApprovedDeploy']
  if (
    previousDeployment &&
    commitsBetween.length === 0 &&
    !compareFailed &&
    commitSha !== previousDeployment.commitSha &&
    !noDiffAlreadyConfirmed &&
    !nearbyApprovedDeployWithSameCommit
  ) {
    const nearbyAnyResult = await pool.query(
      `SELECT d.id, d.commit_sha, d.four_eyes_status
       FROM deployments d
       WHERE d.monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
         AND d.detected_github_owner = $2
         AND d.detected_github_repo_name = $3
         AND d.id != $1
         AND d.four_eyes_status IN (${APPROVED_STATUSES_SQL})
         AND d.created_at BETWEEN (
           (SELECT created_at FROM deployments WHERE id = $1) - interval '30 minutes'
         ) AND (
           (SELECT created_at FROM deployments WHERE id = $1) + interval '30 minutes'
         )
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [deploymentId, owner, repo],
    )
    if (nearbyAnyResult.rows.length > 0) {
      nearbyApprovedDeploy = {
        deploymentId: nearbyAnyResult.rows[0].id,
        commitSha: nearbyAnyResult.rows[0].commit_sha,
        status: nearbyAnyResult.rows[0].four_eyes_status,
      }
    }
  }

  const workflowTriggerResult = await fetchWorkflowTriggerConfig(deploymentId, owner, repo, triggerUrl, options)
  const workflowTrigger = workflowTriggerResult.config

  // fetchWorkflowTriggerConfig runs unconditionally for every deployment with a trigger_url (unlike
  // the branch-name fallback below, which only runs when there's no PR data), so it's the primary
  // source for both github_repo_id and the workflow run's head branch. Only fall back to a second,
  // dedicated live call when fetchWorkflowTriggerConfig didn't itself make one (cached config) and
  // we still need a branch name — this avoids fetching the same workflow run twice per verification.
  let workflowRunHeadBranch = workflowTriggerResult.headBranch
  let detectedGithubRepoId = workflowTriggerResult.repositoryId
  if (!deployedPr?.metadata.headBranch && !workflowTriggerResult.liveFetchPerformed && triggerUrl) {
    const fallback = await resolveWorkflowRunDetails(owner, repo, triggerUrl)
    workflowRunHeadBranch = fallback.headBranch
    detectedGithubRepoId = detectedGithubRepoId ?? fallback.repositoryId
  }
  const detectedBranchName: string | undefined = deployedPr?.metadata.headBranch ?? workflowRunHeadBranch ?? undefined

  const rawFirstCommitMessage = await resolveRawCommitMessage({
    deployedPr,
    commitsBetween,
    previousDeployment,
    owner,
    repo,
    commitSha,
  })
  const detectedTitle: string | undefined = rawFirstCommitMessage
    ? rawFirstCommitMessage.split('\n')[0].trim().slice(0, 500) || undefined
    : undefined

  let commitChecks: VerificationInput['commitChecks']
  let commitChecksAttempted: boolean | undefined
  if (!options?.forceRefresh) {
    const cached = await getCachedCommitChecks(deploymentId)
    if (cached.isCached) {
      commitChecks = cached.commitChecks
      commitChecksAttempted = true
    }
  }
  if (commitChecksAttempted === undefined) {
    const fetched = await fetchCommitChecks(
      owner,
      repo,
      commitSha,
      deployedPr?.metadata.headSha,
      workflowTrigger?.checkSuiteId,
    )
    commitChecks = fetched.commitChecks
    commitChecksAttempted = fetched.attempted
  }

  return {
    deploymentId,
    commitSha,
    repository,
    environmentName,
    baseBranch,
    repositoryStatus,
    commitOnBaseBranch,
    detectedBranchName: detectedBranchName ?? undefined,
    detectedTitle,
    detectedGithubRepoId,
    auditStartYear: appSettings.auditStartYear,
    implicitApprovalSettings: appSettings.implicitApprovalSettings,
    monitoredAppId,
    previousDeployment,
    previousDeploymentLookupFailed,
    previousDeploymentRateLimited,
    deployedPr,
    commitsBetween,
    compareFailed,
    compareSummary,
    nearbyApprovedDeployWithSameCommit,
    nearbyApprovedDeploy,
    branchMismatch,
    workflowTrigger,
    commitChecks,
    commitChecksAttempted,
    dataFreshness: {
      deployedPrFetchedAt: deployedPr ? new Date() : null,
      commitsFetchedAt: commitsBetween.length > 0 ? new Date() : null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      prDerivedFromRaw: deployedPrResult.derivedFromRaw,
      compareDerivedFromRaw,
    },
  }
}

export type { CommitChecksFetchResult } from './fetch-data/commit-checks.server'
export { fetchCommitChecks, refreshCommitChecksOnly } from './fetch-data/commit-checks.server'
export { buildCommitsBetweenFromCache, resolveNoDiffDetection } from './fetch-data/commits-between.server'
export type { FetchOptions } from './fetch-data/pr-data.server'
export { fetchPrFromGitHub, findPrForCommit, getPrDataForDiff } from './fetch-data/pr-data.server'
export type { WorkflowTriggerBackfillResult } from './fetch-data/workflow-triggers.server'
export {
  backfillWorkflowTriggerConfig,
  backfillWorkflowTriggerConfigForAllApps,
  countDeploymentsMissingWorkflowTriggerConfig,
} from './fetch-data/workflow-triggers.server'

export async function getAppSettings(monitoredAppId: number): Promise<{
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings
}> {
  const effective = await getEffectiveSettingsForApp(monitoredAppId)

  return {
    auditStartYear: effective.auditStartYear,
    implicitApprovalSettings: effective.implicitApprovalSettings,
  }
}

export async function resolveRawCommitMessage({
  deployedPr,
  commitsBetween,
  previousDeployment,
  owner,
  repo,
  commitSha,
}: {
  deployedPr: VerificationInput['deployedPr']
  commitsBetween: VerificationInput['commitsBetween']
  previousDeployment: VerificationInput['previousDeployment']
  owner: string
  repo: string
  commitSha: string
}): Promise<string | undefined> {
  if (deployedPr) return undefined
  const fromBetween = commitsBetween[0]?.message
  if (fromBetween) return fromBetween
  if (!previousDeployment) {
    const commitMsg = await getSingleCommitMessage(owner, repo, commitSha)
    return commitMsg ?? undefined
  }
  return undefined
}
