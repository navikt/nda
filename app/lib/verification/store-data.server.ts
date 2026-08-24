import { updateCommitPrVerification } from '~/db/commits.server'
import { pool } from '~/db/connection.server'
import { logStatusTransition } from '~/db/deployments.server'
import { saveVerificationRun } from '~/db/github-data.server'
import { PROTECTED_STATUSES_SQL } from '~/lib/four-eyes-status'
import type { buildGithubPrDataFromSnapshots } from './build-github-pr-data'
import { getCachedPrData } from './fetch-data/pr-data.server'
import type { VerificationInput, VerificationResult } from './types'

export async function storeVerificationResult(
  deploymentId: number,
  result: VerificationResult,
  snapshotIds: {
    prSnapshotIds: number[]
    commitSnapshotIds: number[]
  },
  changeSource?: string,
  commitCacheContext?: {
    repository: string
    commitsBetween: VerificationInput['commitsBetween']
  },
): Promise<{ verificationRunId: number }> {
  const verificationRunId = await saveVerificationRun(
    deploymentId,
    {
      status: result.status,
      result: result,
    },
    snapshotIds,
  )

  await updateDeploymentVerification(deploymentId, result, changeSource)

  if (commitCacheContext) {
    await updateCommitCache(commitCacheContext.repository, result, commitCacheContext.commitsBetween)
  }

  return { verificationRunId }
}

export async function updateDeploymentVerification(
  deploymentId: number,
  result: VerificationResult,
  changeSource?: string,
): Promise<void> {
  if (result.status === 'manually_approved') return
  if (result.status === 'legacy') return

  let githubPrDataJson: string | null = null
  if (result.deployedPr?.number) {
    const prData = await buildGithubPrDataFromSnapshotsForPr(result.deployedPr.number, deploymentId)
    if (prData) {
      githubPrDataJson = JSON.stringify(prData)
    }
  }

  const current = await pool.query(`SELECT four_eyes_status FROM deployments WHERE id = $1`, [deploymentId])

  const updateResult = await pool.query(
    `UPDATE deployments
     SET 
       four_eyes_status = $1,
       github_pr_number = COALESCE($2, github_pr_number),
       github_pr_url = COALESCE($7, github_pr_url),
       unverified_commits = $4::jsonb,
       github_pr_data = COALESCE($5::jsonb, github_pr_data),
       title = COALESCE($6, $9, title),
       branch_name = COALESCE($8, branch_name),
       workflow_trigger_config = COALESCE($10::jsonb, workflow_trigger_config),
       commit_checks_data = COALESCE($11::jsonb, commit_checks_data),
       commit_checks_checked_at = CASE WHEN $12 THEN now() ELSE commit_checks_checked_at END
     WHERE id = $3
       AND four_eyes_status NOT IN (${PROTECTED_STATUSES_SQL})`,
    [
      result.status,
      result.deployedPr?.number || null,
      deploymentId,
      result.unverifiedCommits.length > 0
        ? JSON.stringify(
            result.unverifiedCommits.map((c) => ({
              sha: c.sha,
              message: c.message,
              author: c.author,
              date: c.date,
              html_url: c.htmlUrl,
              pr_number: c.prNumber,
              reason: c.reason,
            })),
          )
        : null,
      githubPrDataJson,
      result.deployedPr?.title || null,
      result.deployedPr?.url || null,
      result.detectedBranchName ?? null,
      result.detectedTitle ?? null,
      result.workflowTrigger ? JSON.stringify(result.workflowTrigger) : null,
      result.commitChecks !== undefined ? JSON.stringify(result.commitChecks) : null,
      result.commitChecksAttempted ?? false,
    ],
  )

  if (updateResult.rowCount && updateResult.rowCount > 0 && current.rows.length > 0) {
    const prev = current.rows[0]
    const newStatus = result.status
    if (prev.four_eyes_status !== newStatus) {
      await logStatusTransition(deploymentId, {
        fromStatus: prev.four_eyes_status,
        toStatus: newStatus,
        changeSource: changeSource || 'verification',
      })
    }
  }
}

// Deliberately not gated by PROTECTED_STATUSES (unlike updateDeploymentVerification below): commit_checks_data
// is purely objective, single-source-of-truth data straight from GitHub's Checks API, and is only ever read
// for display (DeploymentDetailsGrid, PrDetailsAccordion, log-cache job) — never by four-eyes verification,
// status computation, or approval logic. Backfilling it for a manually approved/baseline/legacy deployment
// cannot change that deployment's approval status, so there's no reason to withhold the data.
export async function updateDeploymentCommitChecks(
  deploymentId: number,
  commitChecks: VerificationInput['commitChecks'],
  attempted = true,
): Promise<void> {
  // Nothing to persist: no data was fetched and there's no definitive attempt to record.
  if (!attempted && commitChecks === undefined) return

  await pool.query(
    `UPDATE deployments
     SET commit_checks_data = COALESCE($2::jsonb, commit_checks_data),
         commit_checks_checked_at = CASE WHEN $3 THEN now() ELSE commit_checks_checked_at END
     WHERE id = $1`,
    [deploymentId, commitChecks !== undefined ? JSON.stringify(commitChecks) : null, attempted],
  )
}

async function buildGithubPrDataFromSnapshotsForPr(
  prNumber: number,
  deploymentId: number,
): Promise<ReturnType<typeof buildGithubPrDataFromSnapshots> | null> {
  const deploymentResult = await pool.query(
    `SELECT detected_github_owner, detected_github_repo_name, github_pr_data FROM deployments WHERE id = $1`,
    [deploymentId],
  )
  if (deploymentResult.rows.length === 0) return null

  const {
    detected_github_owner: owner,
    detected_github_repo_name: repo,
    github_pr_data: existingPrData,
  } = deploymentResult.rows[0]
  if (!owner || !repo) return null

  const cachedPrData = await getCachedPrData(owner, repo, prNumber)
  if (!cachedPrData) return null

  const prData = { ...cachedPrData }

  const hasFreshChecks = prData.checks.length > 0
  const hasLegacyChecks = !!existingPrData?.checks && existingPrData.checks.length > 0
  if (!hasFreshChecks && hasLegacyChecks) {
    prData.checks = existingPrData.checks
    prData.checks_passed = existingPrData.checks_passed
    prData.checks_ref = existingPrData.checks_ref ?? null
  }

  return prData
}

async function updateCommitCache(
  repository: string,
  result: VerificationResult,
  commitsBetween: VerificationInput['commitsBetween'],
): Promise<void> {
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) return

  const unverifiedShas = new Set(result.unverifiedCommits.map((c) => c.sha))

  for (const unverified of result.unverifiedCommits) {
    await updateCommitPrVerification(
      owner,
      repo,
      unverified.sha,
      unverified.prNumber,
      null, // prTitle — not available in UnverifiedCommit
      null, // prUrl
      false,
      unverified.reason,
    )
  }

  for (const commit of commitsBetween) {
    if (unverifiedShas.has(commit.sha)) continue
    if (commit.isMergeCommit) continue

    await updateCommitPrVerification(
      owner,
      repo,
      commit.sha,
      commit.pr?.number ?? null,
      null, // prTitle
      null, // prUrl
      true,
      commit.pr ? 'in_approved_pr' : 'in_deployed_pr',
    )
  }
}
