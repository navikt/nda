import {
  claimRepositoryCodeDeliveryAssessmentSyncCandidates,
  deferRepositoryCodeDeliveryAssessmentSync,
  markRepositoryCodeDeliveryAssessmentSyncCompleted,
  markRepositoryCodeDeliveryAssessmentSyncFailed,
  REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION,
} from '~/db/repository-code-delivery-assessment-sync.server'
import {
  type EstablishmentOutcome,
  establishCodeDeliveryForDeployment,
  getDeploymentIdsAwaitingCodeDelivery,
} from '~/db/repository-code-delivery-establishment.server'
import { GITHUB_RATE_LIMIT_SAFETY_BUFFER, getGitHubRateLimitRemaining } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import {
  GitHubRateLimitSafetyBufferReachedError,
  ingestRepositoryDeliveryAssessmentSnapshots,
} from '~/lib/repository-code-delivery/assessment-snapshots.server'
import { evaluateEstablishmentGrounds } from '~/lib/repository-code-delivery/grounds.server'

export const CODE_DELIVERY_SYNC_LIMIT = 100
export const CODE_DELIVERY_ASSESSMENT_SYNC_LIMIT = 10

export interface CodeDeliveryAssessmentSyncResult {
  processed: number
  completed: number
  failed: number
  permanentlyFailed: number
  rateLimited: boolean
}

export async function syncRepositoryCodeDeliveries(
  limit: number = CODE_DELIVERY_SYNC_LIMIT,
): Promise<Record<EstablishmentOutcome['outcome'] | 'failed', number>> {
  const counts = { skipped: 0, unresolved: 0, stale_grounds: 0, already_linked: 0, linked: 0, created: 0, failed: 0 }
  const deploymentIds = await getDeploymentIdsAwaitingCodeDelivery(limit)

  for (const deploymentId of deploymentIds) {
    try {
      const grounds = await evaluateEstablishmentGrounds(deploymentId)
      if (!grounds) {
        counts.skipped++
        continue
      }
      const result = await establishCodeDeliveryForDeployment(deploymentId, grounds)
      counts[result.outcome]++
    } catch (error) {
      counts.failed++
      logger.warn(`⚠️ Code delivery establishment failed for deployment ${deploymentId}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (deploymentIds.length > 0) {
    logger.info('📦 Repository code delivery sync complete', counts)
  }
  return counts
}

export async function syncRepositoryCodeDeliveryAssessmentSnapshots(
  limit: number = CODE_DELIVERY_ASSESSMENT_SYNC_LIMIT,
): Promise<CodeDeliveryAssessmentSyncResult> {
  const result: CodeDeliveryAssessmentSyncResult = {
    processed: 0,
    completed: 0,
    failed: 0,
    permanentlyFailed: 0,
    rateLimited: false,
  }
  const remaining = getGitHubRateLimitRemaining()
  if (remaining !== null && remaining < GITHUB_RATE_LIMIT_SAFETY_BUFFER) {
    result.rateLimited = true
    logger.info('📚 Repository code delivery assessment snapshot sync skipped at GitHub rate limit safety buffer', {
      remaining,
    })
    return result
  }

  const candidates = await claimRepositoryCodeDeliveryAssessmentSyncCandidates(limit)

  for (const [index, candidate] of candidates.entries()) {
    result.processed++
    try {
      await ingestRepositoryDeliveryAssessmentSnapshots(candidate.deliveryId)
      await markRepositoryCodeDeliveryAssessmentSyncCompleted(
        candidate.deliveryId,
        REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION,
      )
      result.completed++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const currentRateLimit = getGitHubRateLimitRemaining()
      if (
        error instanceof GitHubRateLimitSafetyBufferReachedError ||
        (currentRateLimit !== null && currentRateLimit < GITHUB_RATE_LIMIT_SAFETY_BUFFER)
      ) {
        const reason =
          error instanceof GitHubRateLimitSafetyBufferReachedError
            ? message
            : `GitHub rate limit safety buffer reached (${currentRateLimit} remaining)`
        await deferRepositoryCodeDeliveryAssessmentSync(candidate.deliveryId, reason)
        await Promise.all(
          candidates
            .slice(index + 1)
            .map(({ deliveryId }) => deferRepositoryCodeDeliveryAssessmentSync(deliveryId, reason)),
        )
        result.rateLimited = true
        break
      }
      const permanentlyFailed = await markRepositoryCodeDeliveryAssessmentSyncFailed(candidate.deliveryId, message)
      if (permanentlyFailed) result.permanentlyFailed++
      else result.failed++
      logger.warn(`⚠️ Repository delivery assessment snapshot ingestion failed for delivery ${candidate.deliveryId}`, {
        error: message,
        permanentlyFailed,
      })
    }
  }

  if (result.processed > 0 || result.failed > 0 || result.permanentlyFailed > 0 || result.rateLimited) {
    logger.info('📚 Repository code delivery assessment snapshot sync complete', { ...result })
  }
  return result
}
