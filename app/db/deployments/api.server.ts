/**
 * Database queries for external API consumption.
 *
 * These queries support the /api/v1/ endpoints used by KISS and other consumers.
 */

import { pool } from '../connection.server'

interface AppChangeOriginCoverage {
  /** Total deployments (excluding Dependabot) */
  total: number
  /** Deployments linked to an objective or key result */
  linked: number
  /** Dependabot deployments */
  dependabot: number
  /** Coverage percentage (linked / total * 100) */
  coveragePercent: number
}

/**
 * Get change origin (endringsopphav) coverage for a single app within a date range.
 *
 * Counts how many deployments are linked to board objectives/key results,
 * excluding automated Dependabot deployments from the coverage calculation.
 */
export async function getAppChangeOriginCoverage(
  monitoredAppId: number,
  startDate: Date,
  endDate: Date,
  auditStartYear?: number | null,
): Promise<AppChangeOriginCoverage> {
  let sql = `SELECT
      COUNT(DISTINCT d.id)::int AS total_all,
      COUNT(DISTINCT d.id) FILTER (
        WHERE LOWER(d.github_pr_data->'creator'->>'username') = 'dependabot[bot]'
      )::int AS dependabot,
      COUNT(DISTINCT dgl.deployment_id) FILTER (
        WHERE LOWER(d.github_pr_data->'creator'->>'username') IS DISTINCT FROM 'dependabot[bot]'
      )::int AS linked
    FROM deployments d
    LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
    WHERE d.monitored_app_id = $1
      AND d.created_at >= $2
      AND d.created_at <= $3`

  const params: (number | Date)[] = [monitoredAppId, startDate, endDate]

  if (auditStartYear) {
    sql += ` AND EXTRACT(YEAR FROM d.created_at) >= $4`
    params.push(auditStartYear)
  }

  const result = await pool.query(sql, params)

  const row = result.rows[0]
  const totalAll = row?.total_all ?? 0
  const dependabot = row?.dependabot ?? 0
  const linked = row?.linked ?? 0
  const total = totalAll - dependabot
  const coveragePercent = total > 0 ? Math.round((linked / total) * 1000) / 10 : 0

  return { total, linked, dependabot, coveragePercent }
}

interface LastDeploymentSummary {
  createdAt: Date
  deployer: string | null
  commitSha: string | null
  fourEyesStatus: string
  hasChangeOrigin: boolean
}

/**
 * Get a summary of the most recent deployment for an app.
 */
export async function getLastDeploymentSummary(monitoredAppId: number): Promise<LastDeploymentSummary | null> {
  const result = await pool.query(
    `SELECT
      d.created_at,
      d.deployer_username,
      d.commit_sha,
      d.four_eyes_status,
      EXISTS (
        SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id
      ) AS has_change_origin
    FROM deployments d
    WHERE d.monitored_app_id = $1
    ORDER BY d.created_at DESC
    LIMIT 1`,
    [monitoredAppId],
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    createdAt: new Date(row.created_at),
    deployer: row.deployer_username,
    commitSha: row.commit_sha,
    fourEyesStatus: row.four_eyes_status,
    hasChangeOrigin: row.has_change_origin,
  }
}
