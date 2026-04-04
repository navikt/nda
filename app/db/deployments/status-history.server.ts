import { pool } from '../connection.server'
import type { StatusTransition } from '../deployments.server'

export async function logStatusTransition(
  deploymentId: number,
  data: {
    fromStatus: string | null
    toStatus: string
    changeSource: string
    changedBy?: string
    details?: Record<string, unknown>
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO deployment_status_history 
       (deployment_id, from_status, to_status, 
        changed_by, change_source, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      deploymentId,
      data.fromStatus,
      data.toStatus,
      data.changedBy || null,
      data.changeSource,
      data.details ? JSON.stringify(data.details) : null,
    ],
  )
}

export async function getStatusHistory(deploymentId: number): Promise<StatusTransition[]> {
  const result = await pool.query(
    `SELECT * FROM deployment_status_history
     WHERE deployment_id = $1
     ORDER BY created_at ASC`,
    [deploymentId],
  )
  return result.rows
}

export async function getDeploymentsWithStatusChanges(monitoredAppId: number): Promise<
  Array<{
    deployment_id: number
    created_at: Date
    commit_sha: string | null
    four_eyes_status: string
    github_pr_number: number | null
    title: string | null
    transition_count: number
    latest_change: Date
    latest_from_status: string | null
    latest_to_status: string
    latest_change_source: string
  }>
> {
  const result = await pool.query(
    `SELECT 
       d.id as deployment_id,
       d.created_at,
       d.commit_sha,
       d.four_eyes_status,
       d.github_pr_number,
       d.title,
       COUNT(h.id)::int as transition_count,
       MAX(h.created_at) as latest_change,
       (SELECT from_status FROM deployment_status_history 
        WHERE deployment_id = d.id ORDER BY created_at DESC LIMIT 1) as latest_from_status,
       (SELECT to_status FROM deployment_status_history 
        WHERE deployment_id = d.id ORDER BY created_at DESC LIMIT 1) as latest_to_status,
       (SELECT change_source FROM deployment_status_history 
        WHERE deployment_id = d.id ORDER BY created_at DESC LIMIT 1) as latest_change_source
     FROM deployments d
     INNER JOIN deployment_status_history h ON h.deployment_id = d.id
     WHERE d.monitored_app_id = $1
     GROUP BY d.id
     HAVING COUNT(h.id) > 1
     ORDER BY MAX(h.created_at) DESC`,
    [monitoredAppId],
  )
  return result.rows
}
