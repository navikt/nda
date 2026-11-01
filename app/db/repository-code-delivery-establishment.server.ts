import { isFullCommitSha } from '~/lib/git-constants'
import { lockRepositoryCodeDeliveries, pool, withTransaction } from './connection.server'
import {
  createRepositoryCodeDelivery,
  getRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDeliveryInTransaction,
} from './repository-code-deliveries.server'
import { enqueueRepositoryCodeDeliveryAssessmentSync } from './repository-code-delivery-assessment-sync.server'
import { repositoryCodeDeliveryPredecessorSql } from './repository-code-delivery-predecessor-sql'
import { classifiedWorkflowRunDeploymentsCte } from './workflow-run-repository-backfill-coverage.server'

const pendingHistoricalIdentitiesCte = classifiedWorkflowRunDeploymentsCte(`
  r.code_delivery_tracking AND d.deployment_source != 'nais_apply'
`)

const olderPendingHistoricalIdentitySql = `
  EXISTS (
    SELECT 1 FROM classified pending
    WHERE pending.classification = 'eligible'
      AND pending.repository_id = r.id
      AND (pending.created_at, pending.deployment_id) < (d.created_at, d.id)
      AND NOT EXISTS (
        SELECT 1 FROM repository_code_delivery_deployment_repositories identity
        WHERE identity.deployment_id = pending.deployment_id
      )
  )
`

export type UnresolvedReason =
  | 'ancestry_unknown'
  | 'ancestry_diverged'
  | 'ancestry_behind'
  | 'source_unauthorized'
  | 'source_unknown'

export type EstablishmentGrounds =
  | { confirmed: true; baseSha: string | null; headSha: string }
  | { confirmed: false; reason: UnresolvedReason; headSha: string }

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
      `SELECT COALESCE(d.repository_id, identity.repository_id) AS repository_id
       FROM deployments d
       LEFT JOIN repository_code_delivery_deployment_repositories identity ON identity.deployment_id = d.id
       WHERE d.id = $1`,
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
      `SELECT COALESCE(d.repository_id, identity.repository_id) AS repository_id,
              d.commit_sha, d.repository_code_delivery_id
       FROM deployments d
       LEFT JOIN repository_code_delivery_deployment_repositories identity ON identity.deployment_id = d.id
       WHERE d.id = $1 FOR UPDATE OF d`,
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
      await enqueueRepositoryCodeDeliveryAssessmentSync(client, deployment.repository_code_delivery_id)
      return { outcome: 'already_linked', deliveryId: deployment.repository_code_delivery_id }
    }
    const headSha = deployment.commit_sha
    if (!headSha || !isFullCommitSha(headSha)) return { outcome: 'skipped', reason: 'missing_commit_sha' }

    if (grounds.headSha.toLowerCase() !== headSha.toLowerCase()) return { outcome: 'stale_grounds' }

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

    const existing = await getRepositoryCodeDelivery(repositoryId, headSha, client)
    if (existing) {
      await linkDeploymentToRepositoryCodeDeliveryInTransaction(client, deploymentId, existing.id)
      await enqueueRepositoryCodeDeliveryAssessmentSync(client, existing.id)
      return { outcome: 'linked', deliveryId: existing.id }
    }

    const { rows: previous } = await client.query<{ head_sha: string | null }>(
      `SELECT (${repositoryCodeDeliveryPredecessorSql}) AS head_sha
       FROM deployments d WHERE d.id = $1`,
      [deploymentId],
    )
    const currentHead = previous[0]?.head_sha ?? null
    if (grounds.baseSha?.toLowerCase() !== currentHead?.toLowerCase()) return { outcome: 'stale_grounds' }
    const { rows: pendingHistory } = await client.query<{ pending: boolean }>(
      `${pendingHistoricalIdentitiesCte}
       SELECT EXISTS (
         SELECT 1 FROM classified pending
         JOIN deployments older ON older.id = pending.deployment_id
         WHERE pending.classification = 'eligible' AND pending.repository_id = r.id
           AND (pending.created_at, pending.deployment_id) < (d.created_at, d.id)
           AND older.repository_code_delivery_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM repository_code_delivery_unresolved unresolved
             WHERE unresolved.deployment_id = older.id AND unresolved.resolved_at IS NULL
           )
       ) AS pending
       FROM deployments d JOIN repositories r ON r.id = $2
       WHERE d.id = $1`,
      [deploymentId, repositoryId],
    )
    if (pendingHistory[0]?.pending) return { outcome: 'stale_grounds' }
    const baseSha = currentHead ?? headSha
    const created = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha }, client)
    await linkDeploymentToRepositoryCodeDeliveryInTransaction(client, deploymentId, created.id)
    await enqueueRepositoryCodeDeliveryAssessmentSync(client, created.id)
    return { outcome: 'created', deliveryId: created.id, baseSha: created.base_sha, headSha: created.head_sha }
  })
}

export interface EstablishmentContext {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
  githubRepoId: number
  defaultBranch: string | null
  headSha: string
  latestDeliveryHeadSha: string | null
  headHasDelivery: boolean
}

export async function getEstablishmentContext(deploymentId: number): Promise<EstablishmentContext | null> {
  const { rows } = await pool.query<{
    repository_id: number
    github_owner: string
    github_repo_name: string
    github_repo_id: string
    default_branch: string | null
    commit_sha: string
    latest_delivery_head_sha: string | null
    head_has_delivery: boolean
  }>(
    `SELECT r.id AS repository_id, r.github_owner, r.github_repo_name, r.github_repo_id, r.default_branch, d.commit_sha,
            (${repositoryCodeDeliveryPredecessorSql}) AS latest_delivery_head_sha,
            EXISTS (SELECT 1 FROM repository_code_deliveries c
                    WHERE c.repository_id = r.id AND lower(c.head_sha) = lower(d.commit_sha)) AS head_has_delivery
     FROM deployments d
     LEFT JOIN repository_code_delivery_deployment_repositories identity ON identity.deployment_id = d.id
     JOIN repositories r ON r.id = COALESCE(d.repository_id, identity.repository_id)
     WHERE d.id = $1 AND r.code_delivery_tracking = true`,
    [deploymentId],
  )
  const row = rows[0]
  if (!row || !isFullCommitSha(row.commit_sha)) return null
  return {
    repositoryId: row.repository_id,
    githubOwner: row.github_owner,
    githubRepoName: row.github_repo_name,
    githubRepoId: Number(row.github_repo_id),
    defaultBranch: row.default_branch,
    headSha: row.commit_sha,
    latestDeliveryHeadSha: row.latest_delivery_head_sha,
    headHasDelivery: row.head_has_delivery,
  }
}

export async function getDeploymentIdsAwaitingCodeDelivery(limit: number): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `${pendingHistoricalIdentitiesCte}
     SELECT d.id
     FROM deployments d
     LEFT JOIN repository_code_delivery_deployment_repositories identity ON identity.deployment_id = d.id
     JOIN repositories r ON r.id = COALESCE(d.repository_id, identity.repository_id)
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     LEFT JOIN repository_code_delivery_unresolved u ON u.deployment_id = d.id AND u.resolved_at IS NULL
     WHERE r.code_delivery_tracking = true
       AND d.repository_code_delivery_id IS NULL
       AND d.commit_sha ~ '^[0-9a-fA-F]{40}$'
       AND NOT ${olderPendingHistoricalIdentitySql}
       AND (u.deployment_id IS NULL
            OR (u.reason IN ('ancestry_unknown', 'source_unknown', 'ancestry_behind') AND u.updated_at < now() - interval '1 hour'))
     ORDER BY r.id, d.created_at, d.id
     LIMIT $1`,
    [limit],
  )
  return rows.map((row) => row.id)
}

export async function resolveHistoricalDeploymentRepositoryIds(limit: number): Promise<number> {
  const result = await pool.query(
    `${pendingHistoricalIdentitiesCte}, candidates AS (
       SELECT DISTINCT deployment_id, repository_id, created_at
       FROM classified
       WHERE classification = 'eligible'
         AND NOT EXISTS (
           SELECT 1 FROM repository_code_delivery_deployment_repositories identity
           WHERE identity.deployment_id = classified.deployment_id
         )
       ORDER BY created_at, deployment_id
       LIMIT $1
     )
     INSERT INTO repository_code_delivery_deployment_repositories (deployment_id, repository_id)
     SELECT deployment_id, repository_id FROM candidates
     ON CONFLICT (deployment_id) DO NOTHING`,
    [limit],
  )
  return result.rowCount ?? 0
}
