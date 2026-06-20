import { APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { baselineActionSql } from '../baseline-action'
import { pool } from '../connection.server'
import type { AppDeploymentStats } from '../deployments.server'
import { lowerUsernames, userDeploymentMatchAnySql } from '../user-deployment-match'

interface StatsOptions {
  startDate?: Date
  endDate?: Date
}

export async function getAppDeploymentStats(
  monitoredAppId: number,
  startDate?: Date,
  endDate?: Date,
  auditStartYear?: number | null,
): Promise<AppDeploymentStats> {
  const map = await getAppDeploymentStatsBatch([{ id: monitoredAppId, audit_start_year: auditStartYear }], undefined, {
    startDate,
    endDate,
  })
  // biome-ignore lint/style/noNonNullAssertion: guaranteed by getAppDeploymentStatsBatch
  return map.get(monitoredAppId)!
}

export async function getAppDeploymentStatsBatch(
  apps: Array<{ id: number; audit_start_year?: number | null }>,
  deployerUsernames?: string[],
  options?: StatsOptions,
): Promise<Map<number, AppDeploymentStats>> {
  if (apps.length === 0) {
    return new Map()
  }

  const appIds = apps.map((a) => a.id)

  const auditYearCases = apps
    .filter((a) => a.audit_start_year)
    .map((a) => `WHEN monitored_app_id = ${a.id} THEN EXTRACT(YEAR FROM created_at) >= ${a.audit_start_year}`)
    .join(' ')

  const auditYearFilter = auditYearCases ? `AND (CASE ${auditYearCases} ELSE true END)` : ''

  const baseParams: any[] = [appIds, APPROVED_STATUSES, PENDING_STATUSES]
  let paramIndex = 4

  let dateFilter = ''
  if (options?.startDate) {
    dateFilter += ` AND created_at >= $${paramIndex}`
    baseParams.push(options.startDate)
    paramIndex++
  }
  if (options?.endDate) {
    dateFilter += ` AND created_at <= $${paramIndex}`
    baseParams.push(options.endDate)
    paramIndex++
  }

  const hasDeployerFilter = deployerUsernames !== undefined
  const deployerFilterClause = hasDeployerFilter ? ` AND ${userDeploymentMatchAnySql(paramIndex, 'deployments')}` : ''
  if (hasDeployerFilter) {
    baseParams.push(lowerUsernames(deployerUsernames))
    paramIndex++
  }

  const result = await pool.query(
    `SELECT 
      monitored_app_id,
      COUNT(*) FILTER (WHERE TRUE${deployerFilterClause}) as total,
      COUNT(*) FILTER (WHERE COALESCE(four_eyes_status, 'unknown') = ANY($2::text[])${deployerFilterClause}) as with_four_eyes,
      COUNT(*) FILTER (WHERE COALESCE(four_eyes_status, 'unknown') = ANY($3::text[])${deployerFilterClause}) as pending_verification,
      COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = deployments.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL))${deployerFilterClause}) as missing_goal_links,
      MAX(created_at) as last_deployment
    FROM deployments
    WHERE monitored_app_id = ANY($1) ${auditYearFilter} ${dateFilter}
    GROUP BY monitored_app_id`,
    baseParams,
  )

  const baselineResult = await pool.query(
    `SELECT monitored_app_id, COUNT(*) AS baseline_action_count
     FROM deployments
     WHERE monitored_app_id = ANY($1) ${auditYearFilter}
       AND ${baselineActionSql('deployments')}
     GROUP BY monitored_app_id`,
    [appIds],
  )

  const baselineByApp = new Map<number, number>()
  for (const row of baselineResult.rows) {
    baselineByApp.set(row.monitored_app_id, parseInt(row.baseline_action_count, 10) || 0)
  }

  const lastDeploymentResult = await pool.query(
    `SELECT DISTINCT ON (monitored_app_id) monitored_app_id, id
     FROM deployments
     WHERE monitored_app_id = ANY($1)
     ORDER BY monitored_app_id, created_at DESC`,
    [appIds],
  )

  const lastDeploymentIds = new Map<number, number>()
  for (const row of lastDeploymentResult.rows) {
    lastDeploymentIds.set(row.monitored_app_id, row.id)
  }

  const statsMap = new Map<number, AppDeploymentStats>()

  for (const app of apps) {
    statsMap.set(app.id, {
      total: 0,
      with_four_eyes: 0,
      without_four_eyes: 0,
      pending_verification: 0,
      missing_goal_links: 0,
      baseline_action_count: 0,
      last_deployment: null,
      last_deployment_id: lastDeploymentIds.get(app.id) || null,
      four_eyes_percentage: 0,
    })
  }

  for (const row of result.rows) {
    const appId = row.monitored_app_id
    const total = parseInt(row.total, 10) || 0
    const withFourEyes = parseInt(row.with_four_eyes, 10) || 0
    const pending = parseInt(row.pending_verification, 10) || 0
    const withoutFourEyes = Math.max(0, total - withFourEyes - pending)
    const percentage = total > 0 ? Math.round((withFourEyes / total) * 100) : 0

    statsMap.set(appId, {
      total,
      with_four_eyes: withFourEyes,
      without_four_eyes: withoutFourEyes,
      pending_verification: pending,
      missing_goal_links: parseInt(row.missing_goal_links, 10) || 0,
      baseline_action_count: 0, // overwritten in the final pass below
      last_deployment: row.last_deployment ? new Date(row.last_deployment) : null,
      last_deployment_id: lastDeploymentIds.get(appId) || null,
      four_eyes_percentage: percentage,
    })
  }

  for (const [appId, stats] of statsMap) {
    stats.baseline_action_count = baselineByApp.get(appId) ?? 0
  }

  return statsMap
}
