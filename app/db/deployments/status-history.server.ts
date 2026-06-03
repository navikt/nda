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

/**
 * Record a baseline approval for a deployment that already has four_eyes_status = 'baseline'
 * but is missing an attributed approver in its status history (historical data gap).
 *
 * Idempotent at the DB level: a partial UNIQUE index on (deployment_id) WHERE
 * change_source = 'baseline_approval' AND changed_by IS NOT NULL ensures at most one
 * attributed row per deployment. ON CONFLICT DO NOTHING handles concurrent submissions.
 *
 * Returns true if a row was inserted, false if one already existed (no-op).
 * Does NOT change the deployment's four_eyes_status — use updateDeploymentFourEyes for that.
 */
export async function recordBaselineApproval(deploymentId: number, changedBy: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO deployment_status_history
       (deployment_id, from_status, to_status, changed_by, change_source)
     VALUES ($1, 'baseline', 'baseline', $2, 'baseline_approval')
     ON CONFLICT (deployment_id) WHERE change_source = 'baseline_approval' AND changed_by IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [deploymentId, changedBy],
  )
  return result.rows.length > 0
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
