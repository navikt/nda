import { APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { baselineActionSql } from '../baseline-action'
import { pool } from '../connection.server'
import type { AppDeploymentStats } from '../deployments.server'
import { lowerUsernames, userDeploymentMatchAnySql } from '../user-deployment-match'

interface StatsOptions {
  startDate?: Date
  endDate?: Date
}

/**
 * Get deployment stats for a single app.
 *
 * Delegates to {@link getAppDeploymentStatsBatch} so there is a single SQL
 * implementation for all stats queries — deployer filtering, date ranges,
 * audit year, and goal-link counting all behave identically everywhere.
 *
 * If you need deployer-scoped stats (e.g. "stats for team X's deploys"),
 * call `getAppDeploymentStatsBatch` directly with `deployerUsernames`.
 */
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
  // Batch always pre-initializes the Map for every requested app ID
  // biome-ignore lint/style/noNonNullAssertion: guaranteed by getAppDeploymentStatsBatch
  return map.get(monitoredAppId)!
}

/**
 * Get deployment stats for multiple apps in a single query.
 *
 * When `deployerUsernames` is provided, count columns (total, with_four_eyes,
 * without_four_eyes, etc.) are filtered to deployments where a given username
 * is the deployer **or** PR creator — via `userDeploymentMatchAnySql`. This
 * is the same matching logic used in `getDeploymentsPaginated`'s
 * `deployer_usernames` filter, ensuring stat counts agree with list results.
 *
 * `last_deployment` is intentionally **not** filtered by deployer so AppCard
 * always shows the chronologically latest deploy to the app.
 *
 * @returns Map of appId → AppDeploymentStats
 */
export async function getAppDeploymentStatsBatch(
  apps: Array<{ id: number; audit_start_year?: number | null }>,
  deployerUsernames?: string[],
  options?: StatsOptions,
): Promise<Map<number, AppDeploymentStats>> {
  if (apps.length === 0) {
    return new Map()
  }

  const appIds = apps.map((a) => a.id)

  // Build the audit year filter as a CASE expression
  const auditYearCases = apps
    .filter((a) => a.audit_start_year)
    .map((a) => `WHEN monitored_app_id = ${a.id} THEN EXTRACT(YEAR FROM created_at) >= ${a.audit_start_year}`)
    .join(' ')

  const auditYearFilter = auditYearCases ? `AND (CASE ${auditYearCases} ELSE true END)` : ''

  // Build base params and track param index dynamically so deployer/date
  // placeholders bind to the correct $N regardless of which optional
  // filters are active.
  // without_four_eyes is derived as (total - with_four_eyes - pending) in JS,
  // so we only need APPROVED and PENDING status arrays.
  const baseParams: any[] = [appIds, APPROVED_STATUSES, PENDING_STATUSES]
  let paramIndex = 4

  // Date range filter — applied to the main WHERE clause (affects all aggregates).
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

  // Deployer filter is applied only to count/aggregate columns, not to last_deployment.
  // The "last deployment" timestamp/id should always reflect the most recent deploy
  // to the app (regardless of deployer), so AppCard's "last deployment" link/timestamp
  // doesn't silently change meaning when filtering by team members.
  // Empty array ⇒ counts are 0 (FILTER clause matches nothing).
  // Matches both deployer_username and PR creator (case-insensitive) so a team
  // member's PR deployed by a bot still counts toward the team's stats.
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

  // baseline_action_count is intentionally not date-filtered (it reflects
  // outstanding compliance items regardless of viewing period) and not
  // deployer-filtered (baseline compliance is app-level, not per-member).
  // A separate query avoids forcing the main aggregation to scan all rows
  // outside the requested date range just to count baseline items.
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

  // last_deployment_id is intentionally unfiltered by deployer (see note above).
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

  // Initialize with empty stats for all apps
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

  // Fill in actual stats
  for (const row of result.rows) {
    const appId = row.monitored_app_id
    const total = parseInt(row.total, 10) || 0
    const withFourEyes = parseInt(row.with_four_eyes, 10) || 0
    const pending = parseInt(row.pending_verification, 10) || 0
    // Derive without_four_eyes as remainder so numbers always sum to total,
    // even if the DB contains unexpected/unknown status values.
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

  // Apply baseline_action_count to every app — done in a separate pass because
  // the baseline query has no date filter, so apps with no in-period deployments
  // (i.e. no rows in the main result) must still receive their baseline count.
  for (const [appId, stats] of statsMap) {
    stats.baseline_action_count = baselineByApp.get(appId) ?? 0
  }

  return statsMap
}
