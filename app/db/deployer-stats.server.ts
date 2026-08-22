import { APPROVED_STATUSES_SQL, notApprovedWhereClause, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'
import type { DeploymentWithApp } from './deployments.server'
import { TITLE_COALESCE_SQL } from './deployments.server'
import { userDeploymentMatchSql } from './user-deployment-match'

export async function getDeploymentCountByDeployer(deployerUsername: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ${userDeploymentMatchSql(1)}
       AND ${AUDIT_START_YEAR_FILTER}`,
    [deployerUsername],
  )
  return parseInt(result.rows[0].count, 10) || 0
}

export interface DeployerMonthlyStats {
  month: string
  total: number
  with_goal: number
  without_goal: number
  dependabot: number
}

export async function getDeployerMonthlyStats(
  deployerUsername: string,
  startDate?: Date | null,
  endDate?: Date | null,
): Promise<DeployerMonthlyStats[]> {
  let whereSql = `WHERE ${userDeploymentMatchSql(1)} AND ${AUDIT_START_YEAR_FILTER}`
  const params: (string | Date)[] = [deployerUsername]
  let paramIndex = 2

  if (startDate) {
    whereSql += ` AND d.created_at >= $${paramIndex}`
    params.push(startDate)
    paramIndex++
  } else {
    whereSql += ` AND d.created_at >= DATE_TRUNC('month', NOW()) - '24 months'::interval`
  }
  if (endDate) {
    whereSql += ` AND d.created_at <= $${paramIndex}`
    params.push(endDate)
  }

  const result = await pool.query(
    `SELECT
       TO_CHAR(DATE_TRUNC('month', d.created_at), 'YYYY-MM') AS month,
       COUNT(DISTINCT d.id)::int AS total,
       COUNT(DISTINCT d.id) FILTER (
         WHERE d.pr_creator_username = 'dependabot[bot]'
       )::int AS dependabot,
       COUNT(DISTINCT dgl.deployment_id) FILTER (
         WHERE d.pr_creator_username IS DISTINCT FROM 'dependabot[bot]'
       )::int AS with_goal_non_dep
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
     ${whereSql}
     GROUP BY DATE_TRUNC('month', d.created_at)
     ORDER BY month`,
    params,
  )
  return result.rows.map((row: { month: string; total: number; dependabot: number; with_goal_non_dep: number }) => ({
    month: row.month,
    total: row.total,
    dependabot: row.dependabot,
    with_goal: row.with_goal_non_dep,
    without_goal: row.total - row.dependabot - row.with_goal_non_dep,
  }))
}

interface DeployerDeploymentRow extends DeploymentWithApp {
  has_goal_link: boolean
  is_dependabot: boolean
}

interface PaginatedDeployerDeployments {
  deployments: DeployerDeploymentRow[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface DeployerTableFilters {
  goal?: 'all' | 'with_goal' | 'without_goal'
  dependabot?: 'all' | 'only'
  approval?: 'all' | 'approved' | 'not_approved' | 'pending'
  appName?: string
}

export async function getDeployerDeploymentsPaginated(
  deployerUsername: string,
  page = 1,
  perPage = 20,
  startDate?: Date | null,
  endDate?: Date | null,
  filters?: DeployerTableFilters | null,
): Promise<PaginatedDeployerDeployments> {
  const offset = (page - 1) * perPage

  let whereSql = `WHERE ${userDeploymentMatchSql(1)} AND ${AUDIT_START_YEAR_FILTER}`
  const countParams: (string | Date | number)[] = [deployerUsername]
  let paramIndex = 2

  if (startDate) {
    whereSql += ` AND d.created_at >= $${paramIndex}`
    countParams.push(startDate)
    paramIndex++
  }
  if (endDate) {
    whereSql += ` AND d.created_at <= $${paramIndex}`
    countParams.push(endDate)
    paramIndex++
  }

  if (filters?.goal === 'with_goal') {
    whereSql +=
      ' AND EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL))'
  } else if (filters?.goal === 'without_goal') {
    whereSql +=
      ' AND NOT EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL))'
  }

  if (filters?.dependabot === 'only') {
    whereSql += ` AND d.pr_creator_username = 'dependabot[bot]'`
  }

  if (filters?.approval === 'approved') {
    whereSql += ` AND d.four_eyes_status IN (${APPROVED_STATUSES_SQL})`
  } else if (filters?.approval === 'not_approved') {
    whereSql += ` AND ${notApprovedWhereClause('d.four_eyes_status')}`
  } else if (filters?.approval === 'pending') {
    whereSql += ` AND COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})`
  }

  if (filters?.appName) {
    whereSql += ` AND ma.app_name = $${paramIndex}`
    countParams.push(filters.appName)
    paramIndex++
  }

  const dataParams = [...countParams, perPage, offset]

  const [countResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       ${whereSql}`,
      countParams,
    ),
    pool.query(
      `SELECT
         d.*,
         ${TITLE_COALESCE_SQL} AS title,
         ma.team_slug,
         ma.environment_name,
         ma.app_name,
         EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)) AS has_goal_link,
         d.pr_creator_username = 'dependabot[bot]' AS is_dependabot
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       LEFT JOIN commits c ON c.sha = d.commit_sha
         AND c.repo_owner = d.detected_github_owner
         AND c.repo_name = d.detected_github_repo_name
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams,
    ),
  ])

  const total = countResult.rows[0]?.total ?? 0

  return {
    deployments: dataResult.rows,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  }
}

export async function getDeployerApps(deployerUsername: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT ma.app_name
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ${userDeploymentMatchSql(1)}
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY ma.app_name`,
    [deployerUsername],
  )
  return result.rows.map((r: { app_name: string }) => r.app_name)
}
