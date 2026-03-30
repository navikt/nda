import { NOT_APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { pool } from '../connection.server'
import type { AppWithIssues, DeploymentWithApp, IssueDeployment } from '../deployments.server'

/**
 * Get recent deployments for Slack Home Tab
 */
async function getRecentDeploymentsForHomeTab(limit = 10): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*, 
            ma.team_slug, ma.environment_name, ma.app_name
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ma.is_active = true
     ORDER BY d.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Get summary stats for Slack Home Tab
 */
export async function getHomeTabSummaryStats(): Promise<{
  totalApps: number
  totalDeployments: number
  withoutFourEyes: number
  pendingVerification: number
}> {
  const result = await pool.query(
    `
    SELECT 
      (SELECT COUNT(*) FROM monitored_applications WHERE is_active = true) as total_apps,
      (SELECT COUNT(*) FROM deployments d 
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id 
       WHERE ma.is_active = true) as total_deployments,
      (SELECT COUNT(*) FROM deployments d 
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id 
       WHERE ma.is_active = true AND d.four_eyes_status = ANY($1)) as without_four_eyes,
      (SELECT COUNT(*) FROM deployments d 
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id 
       WHERE ma.is_active = true AND d.four_eyes_status = ANY($2)) as pending_verification
  `,
    [NOT_APPROVED_STATUSES, PENDING_STATUSES],
  )
  const row = result.rows[0]
  return {
    totalApps: parseInt(row.total_apps, 10) || 0,
    totalDeployments: parseInt(row.total_deployments, 10) || 0,
    withoutFourEyes: parseInt(row.without_four_eyes, 10) || 0,
    pendingVerification: parseInt(row.pending_verification, 10) || 0,
  }
}

/**
 * Get apps that have issues (missing approval, pending verification, or repo alerts)
 */
export async function getAppsWithIssues(): Promise<AppWithIssues[]> {
  const result = await pool.query(
    `
    SELECT 
      ma.app_name,
      ma.team_slug,
      ma.environment_name,
      COALESCE(dep.without_four_eyes, 0)::integer as without_four_eyes,
      COALESCE(dep.pending_verification, 0)::integer as pending_verification,
      COALESCE(alerts.count, 0)::integer as alert_count
    FROM monitored_applications ma
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN d.four_eyes_status = ANY($1) THEN 1 ELSE 0 END) as without_four_eyes,
        SUM(CASE WHEN d.four_eyes_status = ANY($2) THEN 1 ELSE 0 END) as pending_verification
      FROM deployments d
      WHERE d.monitored_app_id = ma.id
        AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
    ) dep ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as count
      FROM repository_alerts ra
      WHERE ra.monitored_app_id = ma.id AND ra.resolved_at IS NULL
    ) alerts ON true
    WHERE ma.is_active = true
      AND (COALESCE(dep.without_four_eyes, 0) > 0 
        OR COALESCE(dep.pending_verification, 0) > 0 
        OR COALESCE(alerts.count, 0) > 0)
    ORDER BY COALESCE(dep.without_four_eyes, 0) DESC, COALESCE(alerts.count, 0) DESC
  `,
    [NOT_APPROVED_STATUSES, PENDING_STATUSES],
  )
  return result.rows
}

/**
 * Get sample deployments with issues for each app (up to N per app).
 * Used in Slack Home Tab to show specific deployments that need attention.
 */
export async function getIssueDeploymentsPerApp(
  apps: Array<{ app_name: string; team_slug: string; environment_name: string }>,
  limitPerApp = 3,
): Promise<Map<string, IssueDeployment[]>> {
  if (apps.length === 0) return new Map()

  const result = await pool.query(
    `SELECT 
       d.id, d.commit_sha, d.deployer_username, d.four_eyes_status,
       d.github_pr_number, d.github_pr_data, d.title, d.created_at,
       ma.app_name, ma.team_slug, ma.environment_name
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ma.is_active = true
       AND d.has_four_eyes = false
       AND d.four_eyes_status NOT IN ('legacy', 'legacy_pending', 'pending_baseline')
       AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
     ORDER BY d.created_at DESC`,
  )

  const grouped = new Map<string, IssueDeployment[]>()
  for (const row of result.rows) {
    const key = `${row.team_slug}/${row.environment_name}/${row.app_name}`
    const list = grouped.get(key) || []
    if (list.length < limitPerApp) {
      list.push(row)
      grouped.set(key, list)
    }
  }
  return grouped
}
