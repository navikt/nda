import { pool } from '../connection.server'

export interface StatusTransition {
  id: number
  deployment_id: number
  from_status: string | null
  to_status: string
  changed_by: string | null
  change_source: string
  details: Record<string, unknown> | null
  created_at: Date
}

export async function resetVerificationStatus(
  deploymentId: number,
  adminNavIdent: string,
  reason: string,
  fromStatus: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `UPDATE deployments SET four_eyes_status = 'unknown'
       WHERE id = $1 AND four_eyes_status = $2`,
      [deploymentId, fromStatus],
    )
    if (result.rowCount === 0) {
      throw new Error(`Status has changed since page load — expected '${fromStatus}', aborting reset`)
    }
    await client.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, details)
       VALUES ($1, $2, 'unknown', $3, 'admin_reset', $4)`,
      [deploymentId, fromStatus, adminNavIdent, JSON.stringify({ reason })],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

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

interface DeploymentStatusChangeRow {
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
}

export interface RepositoryDeploymentStatusChange extends DeploymentStatusChangeRow {
  team_slug: string
  app_name: string
  environment_name: string
}

export async function getDeploymentsWithStatusChangesForApps(
  monitoredAppIds: number[],
  repositoryId: number,
): Promise<RepositoryDeploymentStatusChange[]> {
  if (monitoredAppIds.length === 0) return []
  const result = await pool.query<RepositoryDeploymentStatusChange>(
    `SELECT 
       d.id as deployment_id,
       d.created_at,
       d.commit_sha,
       d.four_eyes_status,
       d.github_pr_number,
       d.title,
       ma.team_slug,
       ma.app_name,
       ma.environment_name,
       COUNT(h.id)::int as transition_count,
       MAX(h.created_at) as latest_change,
       (SELECT from_status FROM deployment_status_history 
        WHERE deployment_id = d.id ORDER BY created_at DESC, id DESC LIMIT 1) as latest_from_status,
       (SELECT to_status FROM deployment_status_history 
        WHERE deployment_id = d.id ORDER BY created_at DESC, id DESC LIMIT 1) as latest_to_status,
       (SELECT change_source FROM deployment_status_history 
        WHERE deployment_id = d.id ORDER BY created_at DESC, id DESC LIMIT 1) as latest_change_source
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     INNER JOIN deployment_status_history h ON h.deployment_id = d.id
     WHERE d.monitored_app_id = ANY($1)
       AND d.detected_github_owner IS NOT NULL
       AND d.detected_github_repo_name IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM application_repositories ar
         JOIN repositories r ON r.id = $2
         WHERE ar.monitored_app_id = d.monitored_app_id
           AND ar.status IN ('active', 'historical')
           AND (
             (ar.github_repo_id IS NOT NULL AND ar.github_repo_id = r.github_repo_id)
             OR (
               ar.github_repo_id IS NULL
               AND ar.github_owner = r.github_owner
               AND ar.github_repo_name = r.github_repo_name
             )
           )
           AND (
             (d.github_repo_id IS NOT NULL AND d.github_repo_id = r.github_repo_id)
             OR (
               d.github_repo_id IS NULL
               AND d.detected_github_owner = r.github_owner
               AND d.detected_github_repo_name = r.github_repo_name
             )
           )
       )
     GROUP BY d.id, ma.team_slug, ma.app_name, ma.environment_name
     HAVING COUNT(h.id) > 1
     ORDER BY MAX(h.created_at) DESC`,
    [monitoredAppIds, repositoryId],
  )
  return result.rows
}
