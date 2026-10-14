import { pool, withTransaction } from './connection.server'
import type { UnresolvedReason } from './repository-code-delivery-establishment.server'

export interface RepositoryCodeDeliveryOverview {
  deliveryCount: number
  linkedDeploymentCount: number
  awaitingDeploymentCount: number
  unresolvedByReason: Partial<Record<UnresolvedReason, number>>
}

export interface RepositoryHistoryApplicationReadiness {
  team_slug: string
  environment_name: string
  app_name: string
  is_active: boolean
  initial_nais_history_synced_at: Date | null
  deployment_count: number
  repository_deployment_count: number
  unassigned_deployment_count: number
  other_repository_deployment_count: number
  repository_deployments_missing_sha: number
}

export interface RepositoryHistoryReadiness {
  applications: RepositoryHistoryApplicationReadiness[]
  repositoryDeploymentCount: number
  repositoryDeploymentsMissingShaCount: number
  repositoryDeploymentsWithoutKnownAppLinkCount: number
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

export async function getRepositoryHistoryReadiness(repositoryId: number): Promise<RepositoryHistoryReadiness> {
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const applications = await client.query<RepositoryHistoryApplicationReadiness>(
      `WITH repository_apps AS (
         SELECT DISTINCT ar.monitored_app_id
         FROM application_repositories ar
         JOIN repositories r ON r.github_repo_id = ar.github_repo_id
         WHERE r.id = $1 AND ar.status IN ('active', 'historical')
       )
       SELECT ma.team_slug, ma.environment_name, ma.app_name, ma.is_active,
              ma.initial_nais_history_synced_at,
              count(d.id)::int AS deployment_count,
              count(d.id) FILTER (WHERE d.repository_id = $1)::int AS repository_deployment_count,
              count(d.id) FILTER (WHERE d.repository_id IS NULL)::int AS unassigned_deployment_count,
              count(d.id) FILTER (WHERE d.repository_id IS NOT NULL AND d.repository_id <> $1)::int
                AS other_repository_deployment_count,
              count(d.id) FILTER (
                WHERE d.repository_id = $1 AND (d.commit_sha IS NULL OR d.commit_sha !~ '^[0-9a-fA-F]{40}$')
              )::int AS repository_deployments_missing_sha
       FROM repository_apps ra
       JOIN monitored_applications ma ON ma.id = ra.monitored_app_id
       LEFT JOIN deployments d ON d.monitored_app_id = ma.id
       GROUP BY ma.id
       ORDER BY ma.is_active DESC, ma.environment_name, ma.team_slug, ma.app_name`,
      [repositoryId],
    )
    const repositoryDeployments = await client.query<{
      deployment_count: number
      deployments_missing_sha: number
      deployments_without_known_app_link: number
    }>(
      `SELECT count(*)::int AS deployment_count,
              count(*) FILTER (
                WHERE d.commit_sha IS NULL OR d.commit_sha !~ '^[0-9a-fA-F]{40}$'
              )::int AS deployments_missing_sha,
              count(*) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM application_repositories ar
                  WHERE ar.monitored_app_id = d.monitored_app_id
                    AND ar.github_repo_id = r.github_repo_id
                    AND ar.status IN ('active', 'historical')
                )
              )::int AS deployments_without_known_app_link
       FROM deployments d
       JOIN repositories r ON r.id = d.repository_id
       WHERE r.id = $1`,
      [repositoryId],
    )

    return {
      applications: applications.rows,
      repositoryDeploymentCount: repositoryDeployments.rows[0].deployment_count,
      repositoryDeploymentsMissingShaCount: repositoryDeployments.rows[0].deployments_missing_sha,
      repositoryDeploymentsWithoutKnownAppLinkCount: repositoryDeployments.rows[0].deployments_without_known_app_link,
    }
  })
}

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
