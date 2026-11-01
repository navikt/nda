import type { PoolClient } from 'pg'
import { isFullCommitSha } from '~/lib/git-constants'
import { pool, withTransaction } from './connection.server'

export interface RepositoryCodeDelivery {
  id: number
  repository_id: number
  base_sha: string
  head_sha: string
  created_at: Date
}

interface CreateRepositoryCodeDeliveryInput {
  repositoryId: number
  baseSha: string
  headSha: string
}

export class RepositoryCodeDeliveryConflictError extends Error {
  constructor(
    readonly existingDelivery: RepositoryCodeDelivery,
    readonly requestedBaseSha: string,
  ) {
    super(
      `Repository ${existingDelivery.repository_id} already has delivery ${existingDelivery.head_sha} with base ${existingDelivery.base_sha}; requested base ${requestedBaseSha}`,
    )
    this.name = 'RepositoryCodeDeliveryConflictError'
  }
}

function validateRepositoryId(repositoryId: number): void {
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error('Repository ID must be a positive integer')
  }
}

export async function getRepositoryCodeDelivery(
  repositoryId: number,
  headSha: string,
  executor: Pick<PoolClient, 'query'> = pool,
): Promise<RepositoryCodeDelivery | null> {
  validateRepositoryId(repositoryId)
  if (!isFullCommitSha(headSha)) {
    throw new Error('Commit SHA must contain exactly 40 hexadecimal characters')
  }
  const { rows } = await executor.query<RepositoryCodeDelivery>(
    `SELECT id, repository_id, base_sha, head_sha, created_at
     FROM repository_code_deliveries
     WHERE repository_id = $1 AND lower(head_sha) = lower($2)`,
    [repositoryId, headSha],
  )
  return rows[0] ?? null
}

export async function createRepositoryCodeDelivery(
  { repositoryId, baseSha, headSha }: CreateRepositoryCodeDeliveryInput,
  executor: Pick<PoolClient, 'query'> = pool,
): Promise<RepositoryCodeDelivery> {
  validateRepositoryId(repositoryId)
  if (!isFullCommitSha(baseSha) || !isFullCommitSha(headSha)) {
    throw new Error('Commit SHA must contain exactly 40 hexadecimal characters')
  }
  const { rows } = await executor.query<RepositoryCodeDelivery>(
    `INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha)
     VALUES ($1, $2, $3)
     ON CONFLICT (repository_id, lower(head_sha)) DO NOTHING
     RETURNING id, repository_id, base_sha, head_sha, created_at`,
    [repositoryId, baseSha, headSha],
  )
  if (rows[0]) return rows[0]

  const existingDelivery = await getRepositoryCodeDelivery(repositoryId, headSha, executor)
  if (!existingDelivery) {
    throw new Error(`Conflicting code delivery for repository ${repositoryId} and head ${headSha} was not found`)
  }
  if (existingDelivery.base_sha.toLowerCase() !== baseSha.toLowerCase()) {
    throw new RepositoryCodeDeliveryConflictError(existingDelivery, baseSha)
  }
  return existingDelivery
}

export async function linkDeploymentToRepositoryCodeDelivery(
  deploymentId: number,
  deliveryId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(deploymentId) || deploymentId <= 0) {
    throw new Error('Deployment ID must be a positive integer')
  }
  if (!Number.isSafeInteger(deliveryId) || deliveryId <= 0) {
    throw new Error('Code delivery ID must be a positive integer')
  }
  return withTransaction((client) =>
    linkDeploymentToRepositoryCodeDeliveryInTransaction(client, deploymentId, deliveryId),
  )
}

export async function linkDeploymentToRepositoryCodeDeliveryInTransaction(
  client: PoolClient,
  deploymentId: number,
  deliveryId: number,
): Promise<boolean> {
  const { rows: deployments } = await client.query<{
    repository_id: number | null
    commit_sha: string | null
    repository_code_delivery_id: number | null
  }>(
    `SELECT COALESCE(d.repository_id, identity.repository_id) AS repository_id,
            d.commit_sha, d.repository_code_delivery_id
     FROM deployments d
     LEFT JOIN repository_code_delivery_deployment_repositories identity ON identity.deployment_id = d.id
     WHERE d.id = $1 FOR UPDATE OF d`,
    [deploymentId],
  )
  const deployment = deployments[0]
  if (!deployment) throw new Error(`Deployment ${deploymentId} was not found`)

  const { rows: deliveries } = await client.query<Pick<RepositoryCodeDelivery, 'repository_id' | 'head_sha'>>(
    `SELECT repository_id, head_sha
     FROM repository_code_deliveries WHERE id = $1 FOR SHARE`,
    [deliveryId],
  )
  const delivery = deliveries[0]
  if (!delivery) throw new Error(`Code delivery ${deliveryId} was not found`)
  if (deployment.repository_id !== delivery.repository_id) {
    throw new Error(`Deployment ${deploymentId} and code delivery ${deliveryId} have different repository identities`)
  }
  if (
    !deployment.commit_sha ||
    !isFullCommitSha(deployment.commit_sha) ||
    deployment.commit_sha.toLowerCase() !== delivery.head_sha.toLowerCase()
  ) {
    throw new Error(`Deployment ${deploymentId} does not have the full head SHA of code delivery ${deliveryId}`)
  }
  if (deployment.repository_code_delivery_id === deliveryId) {
    await resolveUnresolvedDelivery(client, deploymentId)
    return false
  }
  if (deployment.repository_code_delivery_id !== null) {
    throw new Error(
      `Deployment ${deploymentId} is already linked to code delivery ${deployment.repository_code_delivery_id}`,
    )
  }
  const result = await client.query(
    `UPDATE deployments SET repository_code_delivery_id = $1
     WHERE id = $2 AND repository_code_delivery_id IS NULL`,
    [deliveryId, deploymentId],
  )
  if (result.rowCount !== 1) throw new Error(`Deployment ${deploymentId} code delivery link was not set`)
  await resolveUnresolvedDelivery(client, deploymentId)
  return true
}

async function resolveUnresolvedDelivery(client: PoolClient, deploymentId: number): Promise<void> {
  await client.query(
    `UPDATE repository_code_delivery_unresolved SET resolved_at = now(), updated_at = now()
     WHERE deployment_id = $1 AND resolved_at IS NULL`,
    [deploymentId],
  )
}
