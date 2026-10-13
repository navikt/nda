import {
  type EstablishmentOutcome,
  establishCodeDeliveryForDeployment,
  getDeploymentIdsAwaitingCodeDelivery,
} from '~/db/repository-code-delivery-establishment.server'
import { logger } from '~/lib/logger.server'
import { evaluateEstablishmentGrounds } from '~/lib/repository-code-delivery/grounds.server'

export const CODE_DELIVERY_SYNC_LIMIT = 100

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
