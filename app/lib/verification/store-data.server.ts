/**
 * Store Verification Data
 *
 * This module handles storing verification results to the database.
 * It connects the verification output to the deployment record and
 * stores the verification run history.
 */

import { updateCommitPrVerification } from '~/db/commits.server'
import { pool } from '~/db/connection.server'
import { logStatusTransition } from '~/db/deployments.server'
import { getAllLatestPrSnapshots, saveVerificationRun } from '~/db/github-data.server'
import { buildGithubPrDataFromSnapshots } from './build-github-pr-data'
import type {
  PrChecks,
  PrComment,
  PrCommit,
  PrMetadata,
  PrReview,
  VerificationInput,
  VerificationResult,
} from './types'

// =============================================================================
// Store Verification Result
// =============================================================================

/**
 * Store a verification result and update the deployment record.
 * Also updates the commit cache with PR approval status.
 */
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
  // Save the verification run for history/audit
  const verificationRunId = await saveVerificationRun(
    deploymentId,
    {
      hasFourEyes: result.hasFourEyes,
      status: result.status,
      result: result,
    },
    snapshotIds,
  )

  // Update the deployment record with the verification result
  // Also build and store github_pr_data from snapshots if a PR was found
  await updateDeploymentVerification(deploymentId, result, changeSource)

  // Update commit cache with PR approval status
  if (commitCacheContext) {
    await updateCommitCache(commitCacheContext.repository, result, commitCacheContext.commitsBetween)
  }

  return { verificationRunId }
}

/**
 * Update the deployment table with verification results
 */
async function updateDeploymentVerification(
  deploymentId: number,
  result: VerificationResult,
  changeSource?: string,
): Promise<void> {
  // Determine the four_eyes value for the deployment
  let fourEyesValue: boolean | null = null

  switch (result.status) {
    case 'approved':
      fourEyesValue = true
      break
    case 'implicitly_approved':
      fourEyesValue = true
      break
    case 'unverified_commits':
      fourEyesValue = false
      break
    case 'pending_baseline':
      fourEyesValue = null
      break
    case 'no_changes':
      fourEyesValue = true
      break
    case 'manually_approved':
      // Don't overwrite manual approval
      return
    case 'legacy':
      // Don't update legacy deployments
      return
    case 'error':
      fourEyesValue = null
      break
    case 'unauthorized_repository':
      fourEyesValue = false
      break
    case 'unauthorized_branch':
      fourEyesValue = false
      break
  }

  // Build github_pr_data from snapshots if a PR was found
  let githubPrDataJson: string | null = null
  if (result.deployedPr?.number) {
    const prData = await buildGithubPrDataFromSnapshotsForPr(result.deployedPr.number, deploymentId)
    if (prData) {
      githubPrDataJson = JSON.stringify(prData)
    }
  }

  // Get current status before update for history logging
  const current = await pool.query(`SELECT four_eyes_status, has_four_eyes FROM deployments WHERE id = $1`, [
    deploymentId,
  ])

  // Update deployment record
  await pool.query(
    `UPDATE deployments
     SET 
       has_four_eyes = COALESCE($1, has_four_eyes),
       four_eyes_status = $2,
       github_pr_number = COALESCE($3, github_pr_number),
       unverified_commits = $5::jsonb,
       github_pr_data = COALESCE($6::jsonb, github_pr_data),
       title = COALESCE($7, title)
     WHERE id = $4
       AND four_eyes_status NOT IN ('manually_approved', 'legacy')`,
    [
      fourEyesValue,
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
      result.deployedPr?.title || result.unverifiedCommits[0]?.message || null,
    ],
  )

  // Log status transition if status changed
  if (current.rows.length > 0 && fourEyesValue !== null) {
    const prev = current.rows[0]
    const newStatus = result.status
    if (prev.four_eyes_status !== newStatus || prev.has_four_eyes !== (fourEyesValue === true)) {
      await logStatusTransition(deploymentId, {
        fromStatus: prev.four_eyes_status,
        toStatus: newStatus,
        fromHasFourEyes: prev.has_four_eyes,
        toHasFourEyes: fourEyesValue === true,
        changeSource: changeSource || 'verification',
      })
    }
  }
}

/**
 * Build github_pr_data from DB snapshots for a given PR.
 * Looks up the PR's owner/repo from the deployment record, then reads all snapshots.
 */
async function buildGithubPrDataFromSnapshotsForPr(
  prNumber: number,
  deploymentId: number,
): Promise<ReturnType<typeof buildGithubPrDataFromSnapshots> | null> {
  // Get the owner/repo from the deployment
  const deploymentResult = await pool.query(
    `SELECT detected_github_owner, detected_github_repo_name FROM deployments WHERE id = $1`,
    [deploymentId],
  )
  if (deploymentResult.rows.length === 0) return null

  const { detected_github_owner: owner, detected_github_repo_name: repo } = deploymentResult.rows[0]
  if (!owner || !repo) return null

  const snapshots = await getAllLatestPrSnapshots(owner, repo, prNumber)

  const metadata = snapshots.get('metadata')?.data as PrMetadata | undefined
  if (!metadata) return null

  const reviews = (snapshots.get('reviews')?.data as PrReview[]) ?? null
  const commits = (snapshots.get('commits')?.data as PrCommit[]) ?? null
  const checks = (snapshots.get('checks')?.data as PrChecks) ?? null
  const comments = (snapshots.get('comments')?.data as PrComment[]) ?? null

  return buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)
}

// =============================================================================
// Commit Cache Updates
// =============================================================================

/**
 * Update the commit cache with PR approval status from V2 verification results.
 * Marks unverified commits as not approved and verified commits as approved.
 */
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

  // Mark verified commits (those in commitsBetween but not in unverifiedCommits)
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
