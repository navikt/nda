import type { DeviationFollowUpRole, DeviationIntent, DeviationSeverity } from '~/lib/deviation-constants'
import { query } from './connection.server'

interface DeploymentDeviation {
  id: number
  deployment_id: number
  reason: string
  breach_type: string | null
  intent: DeviationIntent | null
  severity: DeviationSeverity | null
  follow_up_role: DeviationFollowUpRole | null
  registered_by: string
  registered_by_name: string | null
  resolved_at: Date | null
  resolved_by: string | null
  resolved_by_name: string | null
  resolution_note: string | null
  created_at: Date
}

interface DeploymentDeviationWithContext extends DeploymentDeviation {
  app_name?: string
  environment_name?: string
  team_slug?: string
  commit_sha?: string
  title?: string
  deploy_started_at?: Date
}

interface CreateDeviationParams {
  deployment_id: number
  reason: string
  breach_type?: string
  intent?: DeviationIntent
  severity?: DeviationSeverity
  follow_up_role?: DeviationFollowUpRole
  registered_by: string
  registered_by_name?: string
}

export async function createDeviation(params: CreateDeviationParams): Promise<DeploymentDeviation> {
  const result = await query<DeploymentDeviation>(
    `INSERT INTO deployment_deviations (deployment_id, reason, breach_type, intent, severity, follow_up_role, registered_by, registered_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.deployment_id,
      params.reason,
      params.breach_type || null,
      params.intent || null,
      params.severity || null,
      params.follow_up_role || null,
      params.registered_by,
      params.registered_by_name || null,
    ],
  )
  return result.rows[0]
}

export async function getDeviationsByDeploymentId(deploymentId: number): Promise<DeploymentDeviation[]> {
  const result = await query<DeploymentDeviation>(
    'SELECT * FROM deployment_deviations WHERE deployment_id = $1 ORDER BY created_at DESC',
    [deploymentId],
  )
  return result.rows
}

export async function getDeviationsByAppId(
  monitoredAppId: number,
  options?: { resolved?: boolean; limit?: number; offset?: number },
): Promise<DeploymentDeviationWithContext[]> {
  let sql = `
    SELECT dd.*, d.commit_sha, d.title, d.created_at AS deploy_started_at,
           ma.app_name, ma.environment_name, ma.team_slug
    FROM deployment_deviations dd
    JOIN deployments d ON dd.deployment_id = d.id
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.monitored_app_id = $1`
  const params: (number | boolean)[] = [monitoredAppId]
  let paramIndex = 2

  if (options?.resolved === true) {
    sql += ' AND dd.resolved_at IS NOT NULL'
  } else if (options?.resolved === false) {
    sql += ' AND dd.resolved_at IS NULL'
  }

  sql += ' ORDER BY dd.created_at DESC'

  if (options?.limit) {
    sql += ` LIMIT $${paramIndex++}`
    params.push(options.limit)
  }
  if (options?.offset) {
    sql += ` OFFSET $${paramIndex++}`
    params.push(options.offset)
  }

  const result = await query<DeploymentDeviationWithContext>(sql, params)
  return result.rows
}

export async function getDeviationsForPeriod(
  monitoredAppId: number,
  startDate: Date,
  endDate: Date,
): Promise<DeploymentDeviationWithContext[]> {
  const result = await query<DeploymentDeviationWithContext>(
    `SELECT dd.*, d.commit_sha, d.title, d.created_at AS deploy_started_at,
            ma.app_name, ma.environment_name, ma.team_slug
     FROM deployment_deviations dd
     JOIN deployments d ON dd.deployment_id = d.id
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = $1 AND dd.created_at >= $2 AND dd.created_at <= $3
     ORDER BY dd.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )
  return result.rows
}

async function _resolveDeviation(params: {
  id: number
  resolved_by: string
  resolved_by_name?: string
  resolution_note: string
}): Promise<DeploymentDeviation | null> {
  const result = await query<DeploymentDeviation>(
    `UPDATE deployment_deviations
     SET resolved_at = CURRENT_TIMESTAMP, resolved_by = $2, resolved_by_name = $3, resolution_note = $4
     WHERE id = $1
     RETURNING *`,
    [params.id, params.resolved_by, params.resolved_by_name || null, params.resolution_note],
  )
  return result.rows[0] || null
}

async function _getDeviationCountByAppId(monitoredAppId: number): Promise<{ open: number; total: number }> {
  const result = await query<{ open: string; total: string }>(
    `SELECT 
       COUNT(*) FILTER (WHERE dd.resolved_at IS NULL) AS open,
       COUNT(*) AS total
     FROM deployment_deviations dd
     JOIN deployments d ON dd.deployment_id = d.id
     WHERE d.monitored_app_id = $1`,
    [monitoredAppId],
  )
  return {
    open: Number.parseInt(result.rows[0].open, 10),
    total: Number.parseInt(result.rows[0].total, 10),
  }
}
