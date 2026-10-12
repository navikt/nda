import { isFullCommitSha } from '~/lib/git-constants'
import { lockRepositoryCodeDeliveries, withTransaction } from './connection.server'
import {
  createRepositoryCodeDelivery,
  getRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDeliveryInTransaction,
} from './repository-code-deliveries.server'

type UnresolvedReason = 'ancestry_unknown' | 'ancestry_diverged' | 'source_unauthorized'

export type EstablishmentGrounds =
  | { confirmed: true; baseSha: string | null; headSha: string }
  | { confirmed: false; reason: UnresolvedReason }

type SkippedReason = 'tracking_disabled' | 'missing_repository' | 'missing_commit_sha'

export type EstablishmentOutcome =
  | { outcome: 'skipped'; reason: SkippedReason }
  | { outcome: 'unresolved'; reason: UnresolvedReason }
  | { outcome: 'stale_grounds' }
  | { outcome: 'already_linked'; deliveryId: number }
  | { outcome: 'linked'; deliveryId: number }
  | { outcome: 'created'; deliveryId: number; baseSha: string; headSha: string }

interface DeploymentRow {
  repository_id: number | null
  commit_sha: string | null
  repository_code_delivery_id: number | null
}

export async function establishCodeDeliveryForDeployment(
  deploymentId: number,
  grounds: EstablishmentGrounds,
): Promise<EstablishmentOutcome> {
  if (!Number.isSafeInteger(deploymentId) || deploymentId <= 0) {
    throw new Error('Deployment ID must be a positive integer')
  }
  return withTransaction(async (client) => {
    const { rows: initial } = await client.query<Pick<DeploymentRow, 'repository_id'>>(
      `SELECT repository_id FROM deployments WHERE id = $1`,
      [deploymentId],
    )
    if (!initial[0]) throw new Error(`Deployment ${deploymentId} was not found`)
    const repositoryId = initial[0].repository_id
    if (repositoryId === null) return { outcome: 'skipped', reason: 'missing_repository' }

    await lockRepositoryCodeDeliveries(client, repositoryId)

    const { rows: trackingRows } = await client.query<{ code_delivery_tracking: boolean }>(
      `SELECT code_delivery_tracking FROM repositories WHERE id = $1`,
      [repositoryId],
    )
    if (!trackingRows[0]?.code_delivery_tracking) return { outcome: 'skipped', reason: 'tracking_disabled' }

    const { rows: deployments } = await client.query<DeploymentRow>(
      `SELECT repository_id, commit_sha, repository_code_delivery_id
       FROM deployments WHERE id = $1 FOR UPDATE`,
      [deploymentId],
    )
    const deployment = deployments[0]
    if (!deployment || deployment.repository_id !== repositoryId) {
      throw new Error(`Deployment ${deploymentId} changed repository identity during establishment`)
    }
    if (deployment.repository_code_delivery_id !== null) {
      await linkDeploymentToRepositoryCodeDeliveryInTransaction(
        client,
        deploymentId,
        deployment.repository_code_delivery_id,
      )
      return { outcome: 'already_linked', deliveryId: deployment.repository_code_delivery_id }
    }
    const headSha = deployment.commit_sha
    if (!headSha || !isFullCommitSha(headSha)) return { outcome: 'skipped', reason: 'missing_commit_sha' }

    if (!grounds.confirmed) {
      await client.query(
        `INSERT INTO repository_code_delivery_unresolved (deployment_id, reason)
         VALUES ($1, $2)
         ON CONFLICT (deployment_id)
         DO UPDATE SET reason = EXCLUDED.reason, updated_at = now(), resolved_at = NULL`,
        [deploymentId, grounds.reason],
      )
      return { outcome: 'unresolved', reason: grounds.reason }
    }
    if (grounds.headSha.toLowerCase() !== headSha.toLowerCase()) return { outcome: 'stale_grounds' }

    const existing = await getRepositoryCodeDelivery(repositoryId, headSha, client)
    if (existing) {
      await linkDeploymentToRepositoryCodeDeliveryInTransaction(client, deploymentId, existing.id)
      return { outcome: 'linked', deliveryId: existing.id }
    }

    const { rows: previous } = await client.query<{ head_sha: string }>(
      `SELECT head_sha FROM repository_code_deliveries
       WHERE repository_id = $1 ORDER BY id DESC LIMIT 1`,
      [repositoryId],
    )
    const currentHead = previous[0]?.head_sha ?? null
    if (grounds.baseSha?.toLowerCase() !== currentHead?.toLowerCase()) return { outcome: 'stale_grounds' }
    const baseSha = currentHead ?? headSha
    const created = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha }, client)
    await linkDeploymentToRepositoryCodeDeliveryInTransaction(client, deploymentId, created.id)
    return { outcome: 'created', deliveryId: created.id, baseSha: created.base_sha, headSha: created.head_sha }
  })
}
