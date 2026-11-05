import { createHash } from 'node:crypto'
import { withTransaction } from '~/db/connection.server'
import { propagateVerificationToSiblings } from '~/db/monorepo.server'
import {
  deferSiblingWork,
  isBlockingSiblingCandidate,
  isCurrentSiblingRoot,
  lockSiblingWork,
  type SiblingBasis,
  type SiblingWork,
  siblingRetryDelay,
} from '~/db/sibling-verification.server'
import { isRootApprovedStatus, REVERIFIABLE_STATUSES } from '~/lib/four-eyes-status'
import { getGitHubRetryAt } from '~/lib/github/client.server'
import { logger } from '~/lib/logger.server'
import { fetchVerificationData } from './fetch-data.server'
import { applyPassthroughFields } from './index'
import {
  prepareVerificationPrData,
  storeVerificationResult,
  updateCommitCache,
  updateDeploymentCommitChecks,
} from './store-data.server'
import type { VerificationInput, VerificationResult } from './types'
import { verifyDeployment } from './verify'

export type SiblingAttemptOutcome = 'applied' | 'unchanged' | 'stale' | 'deferred'

export function buildSiblingBasis(
  work: SiblingWork,
  input: VerificationInput,
  result: VerificationResult,
): SiblingBasis {
  const basis = {
    version: 1 as const,
    repositoryId: work.verification_repository_id,
    commitSha: input.commitSha,
    baseBranch: input.baseBranch,
    configuredBaseBranch: work.default_branch,
    auditStartYear: input.auditStartYear,
    implicitApprovalMode: input.implicitApprovalSettings.mode,
    repositoryStatus: input.repositoryStatus,
    candidateId: input.previousDeployment?.id ?? null,
    candidateStatus: input.previousDeployment?.fourEyesStatus ?? null,
  }
  const decision = createHash('sha256')
    .update(
      JSON.stringify({
        basis,
        schemaVersion: result.schemaVersion,
        status: result.status,
        hasFourEyes: result.hasFourEyes,
        deployedPr: result.deployedPr,
        unverifiedCommits: result.unverifiedCommits,
        approvalDetails: result.approvalDetails,
        deployedPrReviews: input.deployedPr?.reviews,
        commitPrReviews: input.commitsBetween.map((commit) => ({ sha: commit.sha, reviews: commit.pr?.reviews })),
        baseSha: input.previousDeployment?.commitSha,
        comparisonCommitShas: input.commitsBetween.map(({ sha }) => sha),
      }),
    )
    .digest('hex')
  return { ...basis, decision }
}

export function siblingDeferUntil(work: SiblingWork, attempted = true): Date {
  const reset = getGitHubRetryAt()
  return new Date(
    Math.max(
      Date.now() + siblingRetryDelay(work.id, attempted ? work.sibling_retry_count : 0, true),
      reset?.getTime() ?? 0,
    ),
  )
}

export async function runSiblingVerification(work: SiblingWork, candidate = false): Promise<SiblingAttemptOutcome> {
  if (candidate && !(await isBlockingSiblingCandidate(work))) return 'stale'
  let input: VerificationInput
  let result: VerificationResult
  try {
    input = await fetchVerificationData(
      work.id,
      work.commit_sha,
      `${work.detected_github_owner}/${work.detected_github_repo_name}`,
      work.environment_name,
      work.default_branch,
      work.monitored_app_id,
      { forceRefresh: true, includeComments: false, failOnPrRefreshError: true },
      work.trigger_url,
      work.verification_repository_id ?? undefined,
    )
    result = verifyDeployment(input)
    applyPassthroughFields(result, input)
  } catch (error) {
    logger.error('Sibling verification data fetch failed', { deploymentId: work.id, error })
    await deferSiblingWork(work, candidate, siblingDeferUntil(work), true)
    return 'deferred'
  }

  if (
    result.status === 'error' ||
    input.previousDeploymentLookupFailed ||
    input.previousDeploymentRateLimited ||
    (candidate && REVERIFIABLE_STATUSES.includes(result.status))
  ) {
    logger.warn('Sibling verification deferred', {
      deploymentId: work.id,
      status: result.status,
      reason: result.approvalDetails.reason,
    })
    await deferSiblingWork(work, candidate, siblingDeferUntil(work), true)
    return 'deferred'
  }

  const root = result.status === 'verified_via_sibling' ? input.previousDeployment : undefined
  if (
    result.status === 'verified_via_sibling' &&
    (!root || root.commitSha !== input.commitSha || !isRootApprovedStatus(root.fourEyesStatus ?? ''))
  ) {
    logger.warn('Sibling verification has no current exact-commit root', { deploymentId: work.id })
    await deferSiblingWork(work, candidate, siblingDeferUntil(work), true)
    return 'deferred'
  }

  const basis = buildSiblingBasis(work, input, result)
  const unchanged = work.four_eyes_status === result.status && work.decision_signature === basis.decision
  const githubPrDataJson = unchanged ? null : await prepareVerificationPrData(work.id, result)
  const outcome = await withTransaction(async (client): Promise<SiblingAttemptOutcome> => {
    if (!(await lockSiblingWork(client, work, root?.id))) return 'stale'
    if (root && !(await isCurrentSiblingRoot(client, work, root.id, root.fourEyesStatus ?? ''))) return 'stale'

    if (unchanged) {
      await updateDeploymentCommitChecks(work.id, input.commitChecks, input.commitChecksAttempted ?? false, client)
    } else {
      await storeVerificationResult(
        work.id,
        result,
        { prSnapshotIds: [], commitSnapshotIds: [] },
        input,
        'sibling_reverification',
        undefined,
        { executor: client, githubPrDataJson },
      )
    }

    const waiting = result.status === 'pending_sibling_resolution'
    const retryAt = new Date(Date.now() + siblingRetryDelay(work.id, unchanged ? work.sibling_retry_count : 0))
    await client.query(
      `UPDATE deployments SET sibling_wait_candidate_id = $2, sibling_wait_basis = $3::jsonb,
         sibling_wait_checked_at = clock_timestamp(), sibling_next_attempt_at = $4,
         sibling_refresh_after = $5, sibling_retry_count = $6
       WHERE id = $1`,
      [
        work.id,
        waiting ? basis.candidateId : null,
        JSON.stringify(basis),
        waiting ? retryAt : null,
        candidate && result.status === 'unverified_commits' ? retryAt : null,
        unchanged ? Math.min(work.sibling_retry_count + 1, 100) : 1,
      ],
    )
    return unchanged ? 'unchanged' : 'applied'
  })

  if (outcome === 'applied') {
    try {
      await updateCommitCache(input.repository, result, input.commitsBetween)
      await propagateVerificationToSiblings(
        work.id,
        result.status,
        work.commit_sha,
        work.monitored_app_id,
        result.hasFourEyes,
      )
    } catch (error) {
      logger.error('Sibling verification committed but post-processing failed', { deploymentId: work.id, error })
    }
  }
  return outcome
}
