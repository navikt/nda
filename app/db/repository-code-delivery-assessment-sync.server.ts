import type { PoolClient } from 'pg'
import { pool, withTransaction } from '~/db/connection.server'

export interface RepositoryCodeDeliveryAssessmentSyncCandidate {
  deliveryId: number
  repositoryId: number
  githubRepoId: number
  githubOwner: string
  githubRepoName: string
  defaultBranch: string | null
  baseSha: string
  headSha: string
}

export interface RepositoryCodeDeliveryAssessmentPrSnapshotIds {
  pr: number
  reviews: number
  commits: number
  comments: number
  reviewComments: number
}

export interface RepositoryCodeDeliveryAssessmentSyncProgress {
  completedAssociationSnapshotIds: Record<string, number>
  completedPullRequestSnapshotIds: Record<string, RepositoryCodeDeliveryAssessmentPrSnapshotIds>
}

export async function enqueueRepositoryCodeDeliveryAssessmentSync(
  client: Pick<PoolClient, 'query'>,
  deliveryId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO repository_code_delivery_assessment_sync (delivery_id)
     VALUES ($1)
     ON CONFLICT (delivery_id) DO UPDATE
     SET attempt_count = 0,
         next_attempt_at = now(),
         locked_until = NULL,
         failed_permanently = false,
         completed_association_snapshot_ids = '{}'::jsonb,
         completed_pull_request_snapshot_ids = '{}'::jsonb,
         last_error = NULL,
         updated_at = now()
     WHERE repository_code_delivery_assessment_sync.failed_permanently = true`,
    [deliveryId],
  )
}

export async function claimRepositoryCodeDeliveryAssessmentSyncCandidates(
  limit: number,
): Promise<RepositoryCodeDeliveryAssessmentSyncCandidate[]> {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO repository_code_delivery_assessment_sync (delivery_id)
       SELECT delivery.id
       FROM repository_code_deliveries delivery
       JOIN repositories repository ON repository.id = delivery.repository_id
       WHERE repository.code_delivery_tracking_since IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM repository_code_delivery_assessment_sync existing
           WHERE existing.delivery_id = delivery.id
         )
       ON CONFLICT (delivery_id) DO NOTHING`,
    )

    const { rows } = await client.query<RepositoryCodeDeliveryAssessmentSyncCandidate>(
      `WITH candidates AS (
         SELECT sync.delivery_id
         FROM repository_code_delivery_assessment_sync sync
         JOIN repository_code_deliveries delivery ON delivery.id = sync.delivery_id
         JOIN repositories repository ON repository.id = delivery.repository_id
         WHERE sync.completed_at IS NULL
           AND sync.next_attempt_at <= now()
           AND (sync.locked_until IS NULL OR sync.locked_until < now())
           AND sync.failed_permanently = false
           AND repository.code_delivery_tracking = true
         ORDER BY sync.next_attempt_at, sync.delivery_id
         LIMIT $1
         FOR UPDATE OF sync SKIP LOCKED
       )
       UPDATE repository_code_delivery_assessment_sync sync
       SET attempt_count = sync.attempt_count + 1,
           locked_until = now() + interval '30 minutes',
           updated_at = now()
       FROM candidates, repository_code_deliveries delivery, repositories repository
       WHERE sync.delivery_id = candidates.delivery_id
         AND delivery.id = sync.delivery_id
         AND repository.id = delivery.repository_id
       RETURNING delivery.id AS "deliveryId",
                 delivery.repository_id AS "repositoryId",
                 repository.github_repo_id AS "githubRepoId",
                 repository.github_owner AS "githubOwner",
                 repository.github_repo_name AS "githubRepoName",
                 repository.default_branch AS "defaultBranch",
                 delivery.base_sha AS "baseSha",
                 delivery.head_sha AS "headSha"`,
      [limit],
    )
    return rows.map((row) => ({ ...row, githubRepoId: Number(row.githubRepoId) }))
  })
}

export async function getRepositoryCodeDeliveryAssessmentSyncProgress(
  deliveryId: number,
): Promise<RepositoryCodeDeliveryAssessmentSyncProgress> {
  const { rows } = await pool.query<RepositoryCodeDeliveryAssessmentSyncProgress>(
    `SELECT completed_association_snapshot_ids AS "completedAssociationSnapshotIds",
            completed_pull_request_snapshot_ids AS "completedPullRequestSnapshotIds"
     FROM repository_code_delivery_assessment_sync
     WHERE delivery_id = $1`,
    [deliveryId],
  )
  const progress = rows[0]
  if (!progress) throw new Error(`Assessment sync queue row missing for delivery ${deliveryId}`)
  return progress
}

export async function markRepositoryCodeDeliveryAssessmentAssociationCompleted(
  deliveryId: number,
  sha: string,
  snapshotId: number,
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE repository_code_delivery_assessment_sync
     SET completed_association_snapshot_ids = jsonb_set(
           completed_association_snapshot_ids,
           ARRAY[$2::text],
           to_jsonb($3::bigint),
           true
         ),
         updated_at = now()
     WHERE delivery_id = $1`,
    [deliveryId, sha, snapshotId],
  )
  if (rowCount === 0) throw new Error(`Assessment sync queue row missing for delivery ${deliveryId}`)
}

export async function markRepositoryCodeDeliveryAssessmentPullRequestCompleted(
  deliveryId: number,
  pullRequestNumber: number,
  snapshotIds: RepositoryCodeDeliveryAssessmentPrSnapshotIds,
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE repository_code_delivery_assessment_sync
     SET completed_pull_request_snapshot_ids = jsonb_set(
           completed_pull_request_snapshot_ids,
           ARRAY[$2::text],
           $3::jsonb,
           true
         ),
         updated_at = now()
     WHERE delivery_id = $1`,
    [deliveryId, pullRequestNumber, JSON.stringify(snapshotIds)],
  )
  if (rowCount === 0) throw new Error(`Assessment sync queue row missing for delivery ${deliveryId}`)
}

export async function markRepositoryCodeDeliveryAssessmentSyncCompleted(deliveryId: number): Promise<void> {
  await pool.query(
    `UPDATE repository_code_delivery_assessment_sync
     SET completed_at = now(), locked_until = NULL, last_error = NULL, updated_at = now()
     WHERE delivery_id = $1`,
    [deliveryId],
  )
}

export async function markRepositoryCodeDeliveryAssessmentSyncFailed(
  deliveryId: number,
  error: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ failed_permanently: boolean }>(
    `UPDATE repository_code_delivery_assessment_sync
     SET next_attempt_at = now() + make_interval(secs => LEAST(86400, 30 * power(2, LEAST(attempt_count, 11))::int)),
         locked_until = NULL,
         failed_permanently = attempt_count >= 12,
         last_error = $2,
         updated_at = now()
     WHERE delivery_id = $1
     RETURNING failed_permanently`,
    [deliveryId, error],
  )
  if (!rows[0]) throw new Error(`Assessment sync queue row missing for delivery ${deliveryId}`)
  return rows[0].failed_permanently
}

export async function deferRepositoryCodeDeliveryAssessmentSync(deliveryId: number, reason: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE repository_code_delivery_assessment_sync
     SET attempt_count = GREATEST(attempt_count - 1, 0),
         next_attempt_at = now() + interval '5 minutes',
         locked_until = NULL,
         last_error = $2,
         updated_at = now()
     WHERE delivery_id = $1`,
    [deliveryId, reason],
  )
  if (rowCount === 0) throw new Error(`Assessment sync queue row missing for delivery ${deliveryId}`)
}
