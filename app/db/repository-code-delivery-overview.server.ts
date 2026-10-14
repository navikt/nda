import { pool } from './connection.server'
import type { UnresolvedReason } from './repository-code-delivery-establishment.server'

export interface RepositoryCodeDeliveryOverview {
  deliveryCount: number
  linkedDeploymentCount: number
  awaitingDeploymentCount: number
  unresolvedByReason: Partial<Record<UnresolvedReason, number>>
}

export interface RepositoryCodeDeliverySummary {
  id: number
  base_sha: string
  head_sha: string
  created_at: Date
  first_deployed_at: Date | null
  is_anchor: boolean
  deployment_count: number
  app_names: string[]
}

export type RepositoryCodeDeliverySortKey =
  | 'first_deployed_at'
  | 'created_at'
  | 'base_sha'
  | 'head_sha'
  | 'deployment_count'
  | 'app_names'

export type RepositoryCodeDeliverySortDirection = 'ascending' | 'descending'

export interface UnresolvedCodeDeployment {
  deployment_id: number
  team_slug: string
  environment_name: string
  app_name: string
  commit_sha: string
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  deployed_at: Date
  reason: UnresolvedReason
  first_seen_at: Date
  last_attempt_at: Date
}

export async function getRepositoryCodeDeliveryOverview(repositoryId: number): Promise<RepositoryCodeDeliveryOverview> {
  const [deliveries, linked, awaiting, unresolved] = await Promise.all([
    pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM repository_code_deliveries WHERE repository_id = $1`,
      [repositoryId],
    ),
    pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM deployments
       WHERE repository_id = $1 AND repository_code_delivery_id IS NOT NULL`,
      [repositoryId],
    ),
    pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM deployments d
       JOIN repositories r ON r.id = d.repository_id
       LEFT JOIN repository_code_delivery_unresolved u ON u.deployment_id = d.id AND u.resolved_at IS NULL
       WHERE d.repository_id = $1
         AND r.code_delivery_tracking = true
         AND r.code_delivery_tracking_since IS NOT NULL
         AND d.created_at >= r.code_delivery_tracking_since
         AND d.repository_code_delivery_id IS NULL
         AND d.commit_sha ~ '^[0-9a-fA-F]{40}$'
         AND u.deployment_id IS NULL`,
      [repositoryId],
    ),
    pool.query<{ reason: UnresolvedReason; count: number }>(
      `SELECT u.reason, count(*)::int AS count
       FROM repository_code_delivery_unresolved u
       JOIN deployments d ON d.id = u.deployment_id
       WHERE d.repository_id = $1 AND u.resolved_at IS NULL
       GROUP BY u.reason`,
      [repositoryId],
    ),
  ])

  const unresolvedByReason: Partial<Record<UnresolvedReason, number>> = {}
  for (const row of unresolved.rows) {
    unresolvedByReason[row.reason] = row.count
  }

  return {
    deliveryCount: deliveries.rows[0].count,
    linkedDeploymentCount: linked.rows[0].count,
    awaitingDeploymentCount: awaiting.rows[0].count,
    unresolvedByReason,
  }
}

export async function listRepositoryCodeDeliveries(
  repositoryId: number,
  options: {
    limit: number
    offset: number
    sort?: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection }
  },
): Promise<RepositoryCodeDeliverySummary[]> {
  const sortColumns: Record<RepositoryCodeDeliverySortKey, string> = {
    first_deployed_at: 'first_deployed_at',
    created_at: 'c.created_at',
    base_sha: 'c.base_sha',
    head_sha: 'c.head_sha',
    deployment_count: 'deployment_count',
    app_names: 'app_names',
  }
  const orderBy = options.sort
    ? `${sortColumns[options.sort.orderBy]} ${options.sort.direction === 'ascending' ? 'ASC' : 'DESC'} NULLS LAST, c.id DESC`
    : 'c.id DESC'
  const { rows } = await pool.query<RepositoryCodeDeliverySummary>(
    `SELECT c.id, c.base_sha, c.head_sha, c.created_at,
            min(d.created_at) AS first_deployed_at,
            lower(c.base_sha) = lower(c.head_sha) AS is_anchor,
            count(d.id)::int AS deployment_count,
            COALESCE(array_agg(DISTINCT d.app_name ORDER BY d.app_name) FILTER (WHERE d.id IS NOT NULL), '{}') AS app_names
     FROM repository_code_deliveries c
     LEFT JOIN deployments d ON d.repository_code_delivery_id = c.id
     WHERE c.repository_id = $1
     GROUP BY c.id
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`,
    [repositoryId, options.limit, options.offset],
  )
  return rows
}

export async function listOpenUnresolvedCodeDeployments(
  repositoryId: number,
  limit: number,
): Promise<UnresolvedCodeDeployment[]> {
  const { rows } = await pool.query<UnresolvedCodeDeployment>(
    `SELECT d.id AS deployment_id, d.team_slug, d.environment_name, d.app_name, d.commit_sha,
            d.detected_github_owner, d.detected_github_repo_name, d.created_at AS deployed_at, u.reason, u.created_at AS first_seen_at, u.updated_at AS last_attempt_at
     FROM repository_code_delivery_unresolved u
     JOIN deployments d ON d.id = u.deployment_id
     WHERE d.repository_id = $1 AND u.resolved_at IS NULL
     ORDER BY u.updated_at DESC, d.id DESC
     LIMIT $2`,
    [repositoryId, limit],
  )
  return rows
}
