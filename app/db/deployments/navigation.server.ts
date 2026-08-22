import { LEGACY_STATUSES_SQL, notApprovedWhereClause, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import { baselineActionSql } from '../baseline-action'
import { pool } from '../connection.server'
import type { Deployment } from '../deployments.server'

export interface DeploymentNavFilters {
  four_eyes_status?: string
  method?: 'pr' | 'direct_push' | 'legacy'
  deployer_username?: string
  commit_sha?: string
  start_date?: Date
  end_date?: Date
  audit_start_year?: number | null
}

function buildNavFilterConditions(
  filters: DeploymentNavFilters,
  startParamIndex: number,
): { conditions: string[]; params: any[]; nextIndex: number } {
  const conditions: string[] = []
  const params: any[] = []
  let idx = startParamIndex

  if (filters.four_eyes_status) {
    if (filters.four_eyes_status === 'not_approved') {
      conditions.push(notApprovedWhereClause('nav_dep.four_eyes_status'))
    } else if (filters.four_eyes_status === 'pending') {
      conditions.push(`COALESCE(nav_dep.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})`)
    } else if (filters.four_eyes_status === 'baseline_action') {
      conditions.push(baselineActionSql('nav_dep'))
    } else {
      conditions.push(`nav_dep.four_eyes_status = $${idx}`)
      params.push(filters.four_eyes_status)
      idx++
    }
  }

  if (filters.method === 'pr') {
    conditions.push('nav_dep.github_pr_number IS NOT NULL')
  } else if (filters.method === 'direct_push') {
    conditions.push("nav_dep.github_pr_number IS NULL AND nav_dep.four_eyes_status != 'legacy'")
  } else if (filters.method === 'legacy') {
    conditions.push("nav_dep.four_eyes_status = 'legacy'")
  }

  if (filters.deployer_username) {
    conditions.push(`nav_dep.deployer_username ILIKE $${idx}`)
    params.push(`%${filters.deployer_username}%`)
    idx++
  }

  if (filters.commit_sha) {
    conditions.push(`nav_dep.commit_sha ILIKE $${idx}`)
    params.push(`%${filters.commit_sha}%`)
    idx++
  }

  if (filters.start_date) {
    conditions.push(`nav_dep.created_at >= $${idx}`)
    params.push(filters.start_date)
    idx++
  }

  if (filters.end_date) {
    conditions.push(`nav_dep.created_at <= $${idx}`)
    params.push(filters.end_date)
    idx++
  }

  if (filters.audit_start_year) {
    conditions.push(`EXTRACT(YEAR FROM nav_dep.created_at) >= $${idx}`)
    params.push(filters.audit_start_year)
    idx++
  }

  return { conditions, params, nextIndex: idx }
}

export async function getNextDeployment(
  currentDeploymentId: number,
  monitoredAppId: number,
  filters: DeploymentNavFilters = {},
): Promise<Deployment | null> {
  const { conditions, params } = buildNavFilterConditions(filters, 3)

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT nav_dep.* FROM deployments nav_dep
     CROSS JOIN deployments curr_dep
     WHERE nav_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND nav_dep.created_at > curr_dep.created_at
       ${whereClause}
     ORDER BY nav_dep.created_at ASC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId, ...params],
  )

  return result.rows[0] || null
}

export async function getPreviousDeploymentForNav(
  currentDeploymentId: number,
  monitoredAppId: number,
  filters: DeploymentNavFilters = {},
): Promise<Deployment | null> {
  const { conditions, params } = buildNavFilterConditions(filters, 3)

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT nav_dep.* FROM deployments nav_dep
     CROSS JOIN deployments curr_dep
     WHERE nav_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND nav_dep.created_at < curr_dep.created_at
       ${whereClause}
     ORDER BY nav_dep.created_at DESC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId, ...params],
  )

  return result.rows[0] || null
}

export async function getPreviousDeploymentForDiff(
  currentDeploymentId: number,
  monitoredAppId: number,
  auditStartYear?: number | null,
): Promise<{ commit_sha: string } | null> {
  let sql = `SELECT prev.commit_sha FROM deployments prev
     CROSS JOIN deployments curr
     WHERE prev.monitored_app_id = $1
       AND curr.id = $2
       AND prev.created_at < curr.created_at
       AND prev.commit_sha IS NOT NULL
       AND prev.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
       AND prev.commit_sha !~ '^refs/'`

  const params: (number | string)[] = [monitoredAppId, currentDeploymentId]

  if (auditStartYear) {
    sql += ` AND prev.created_at >= make_date($3, 1, 1)`
    params.push(auditStartYear)
  }

  sql += ` ORDER BY prev.created_at DESC LIMIT 1`

  const result = await pool.query(sql, params)
  return result.rows[0] || null
}
