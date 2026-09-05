import { APPROVED_STATUSES_SQL, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'
import { effectiveAuditStartYearSql } from './repository-settings-sql'
import { lowerUsernames, userDeploymentMatchAnySql } from './user-deployment-match'

interface SectionOverallStats {
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  linked_to_goal: number
  four_eyes_coverage: number
  goal_coverage: number
}

interface DevTeamDashboardStats {
  dev_team_id: number
  dev_team_name: string
  dev_team_slug: string
  nais_team_slugs: string[]
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  linked_to_goal: number
  four_eyes_coverage: number
  goal_coverage: number
}

interface DevTeamSummaryStats {
  total_apps: number
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  linked_to_goal: number
  four_eyes_coverage: number
  goal_coverage: number
  four_eyes_percentage: number
  goal_percentage: number
  apps_with_issues: number
}

export async function getSectionOverallStats(
  sectionId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<SectionOverallStats> {
  const result = await pool.query(
    `SELECT
       COUNT(d.id)::int AS total_deployments,
       COUNT(d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL}))::int AS with_four_eyes,
       COUNT(d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL}))::int AS pending_verification,
       COUNT(DISTINCT dgl.deployment_id)::int AS linked_to_goal
     FROM section_teams st
     JOIN deployments d ON d.team_slug = st.team_slug
       AND ($2::timestamptz IS NULL OR d.created_at >= $2)
       AND ($3::timestamptz IS NULL OR d.created_at < $3)
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       AND ${AUDIT_START_YEAR_FILTER}
     LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id AND dgl.is_active = true
         AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
     WHERE st.section_id = $1 AND st.deleted_at IS NULL`,
    [sectionId, startDate ?? null, endDate ?? null],
  )

  const row = result.rows[0]
  const total = row?.total_deployments ?? 0
  const withFourEyes = row?.with_four_eyes ?? 0
  const pending = row?.pending_verification ?? 0
  const linked = row?.linked_to_goal ?? 0

  return {
    total_deployments: total,
    with_four_eyes: withFourEyes,
    without_four_eyes: Math.max(0, total - withFourEyes - pending),
    pending_verification: pending,
    linked_to_goal: linked,
    four_eyes_coverage: total > 0 ? withFourEyes / total : 0,
    goal_coverage: total > 0 ? linked / total : 0,
  }
}

export async function getSectionDashboardStats(
  sectionId: number,
  startDate?: Date,
  endDate?: Date,
): Promise<DevTeamDashboardStats[]> {
  const result = await pool.query(
    `WITH team_apps AS (
       -- Direct app links
       SELECT dt.id AS dev_team_id, dt.name AS dev_team_name, dt.slug AS dev_team_slug,
              COALESCE(array_agg(DISTINCT dtn.nais_team_slug) FILTER (WHERE dtn.nais_team_slug IS NOT NULL), '{}') AS nais_team_slugs,
              array_agg(DISTINCT dta.monitored_app_id) FILTER (WHERE dta.monitored_app_id IS NOT NULL) AS direct_app_ids
       FROM dev_teams dt
       LEFT JOIN dev_team_nais_teams dtn ON dtn.dev_team_id = dt.id AND dtn.deleted_at IS NULL
       LEFT JOIN dev_team_applications dta ON dta.dev_team_id = dt.id AND dta.deleted_at IS NULL
       WHERE dt.section_id = $1 AND dt.is_active = true
       GROUP BY dt.id
     ),
     deployment_stats AS (
       SELECT ta.dev_team_id,
              COUNT(d.id) AS total_deployments,
              COUNT(d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})) AS with_four_eyes,
              COUNT(d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})) AS pending_verification,
              COUNT(DISTINCT dgl.deployment_id) AS linked_to_goal
       FROM team_apps ta
       LEFT JOIN LATERAL (
         SELECT d.*
         FROM deployments d
         JOIN monitored_applications ma ON ma.id = d.monitored_app_id
         WHERE (
           d.team_slug = ANY(ta.nais_team_slugs)
           OR d.monitored_app_id = ANY(COALESCE(ta.direct_app_ids, '{}'::int[]))
         )
           AND ($2::timestamptz IS NULL OR d.created_at >= $2)
           AND ($3::timestamptz IS NULL OR d.created_at < $3)
           AND ${AUDIT_START_YEAR_FILTER}
       ) d ON true
       LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id AND dgl.is_active = true
         AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
       GROUP BY ta.dev_team_id
     )
     SELECT ta.dev_team_id, ta.dev_team_name, ta.dev_team_slug,
            ta.nais_team_slugs,
            COALESCE(ds.total_deployments, 0)::int AS total_deployments,
            COALESCE(ds.with_four_eyes, 0)::int AS with_four_eyes,
            COALESCE(ds.total_deployments, 0)::int - COALESCE(ds.with_four_eyes, 0)::int - COALESCE(ds.pending_verification, 0)::int AS without_four_eyes,
            COALESCE(ds.pending_verification, 0)::int AS pending_verification,
            COALESCE(ds.linked_to_goal, 0)::int AS linked_to_goal
     FROM team_apps ta
     LEFT JOIN deployment_stats ds ON ds.dev_team_id = ta.dev_team_id
     ORDER BY ta.dev_team_name`,
    [sectionId, startDate ?? null, endDate ?? null],
  )

  return result.rows.map((row) => ({
    ...row,
    four_eyes_coverage: row.total_deployments > 0 ? row.with_four_eyes / row.total_deployments : 0,
    goal_coverage: row.total_deployments > 0 ? row.linked_to_goal / row.total_deployments : 0,
  }))
}

export async function getDevTeamSummaryStats(
  naisTeamSlugs: string[],
  directAppIds?: number[],
  startDate?: Date,
  deployerUsernames?: string[],
  devTeamId?: number | number[],
): Promise<DevTeamSummaryStats> {
  const ids = directAppIds ?? []

  const hasDeployerFilter = deployerUsernames !== undefined
  const params: unknown[] = [naisTeamSlugs, ids, startDate ?? null]

  const devTeamIds = devTeamId !== undefined ? (Array.isArray(devTeamId) ? devTeamId : [devTeamId]) : undefined
  if (devTeamIds !== undefined) {
    params.push(devTeamIds)
    const devTeamIdParam = params.length
    const effectiveDeployers = deployerUsernames ?? []
    params.push(lowerUsernames(effectiveDeployers))
    const deployerParam = params.length

    const result = await pool.query(
      `WITH team_apps AS (
         SELECT ma.id, ${effectiveAuditStartYearSql('ma')} AS audit_start_year
         FROM monitored_applications ma
         WHERE ma.is_active = true
           AND (ma.team_slug = ANY($1::text[]) OR ma.id = ANY($2::int[]))
       ),
       -- Deployments linked to this team's board
       board_linked AS (
         SELECT DISTINCT d.id AS deployment_id
         FROM boards b
         JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
         JOIN deployment_goal_links dgl ON dgl.is_active = true
           AND (dgl.objective_id = bo.id
                OR dgl.key_result_id IN (SELECT bkr.id FROM board_key_results bkr WHERE bkr.objective_id = bo.id AND bkr.is_active = true))
         JOIN deployments d ON d.id = dgl.deployment_id
           AND ($3::timestamptz IS NULL OR d.created_at >= $3)
         JOIN team_apps ta ON ta.id = d.monitored_app_id
         WHERE b.dev_team_id = ANY($${devTeamIdParam}::int[]) AND b.is_active = true
           AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
       ),
       -- Unlinked deployments by team members
       unlinked_member AS (
         SELECT DISTINCT d.id AS deployment_id
         FROM team_apps ta
         JOIN deployments d ON d.monitored_app_id = ta.id
           AND ($3::timestamptz IS NULL OR d.created_at >= $3)
           AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
           AND (LOWER(d.deployer_username) = ANY($${deployerParam}::text[])
                OR d.pr_creator_username = ANY($${deployerParam}::text[]))
         WHERE NOT EXISTS (
           SELECT 1 FROM deployment_goal_links dgl
           JOIN board_objectives bo ON (dgl.objective_id = bo.id
             OR dgl.key_result_id IN (SELECT bkr.id FROM board_key_results bkr WHERE bkr.objective_id = bo.id AND bkr.is_active = true))
           JOIN boards b ON b.id = bo.board_id AND b.is_active = true
           WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND bo.is_active = true
         )
       ),
       team_deployments AS (
         SELECT deployment_id FROM board_linked
         UNION
         SELECT deployment_id FROM unlinked_member
       ),
       app_stats AS (
         SELECT d.monitored_app_id,
                COUNT(DISTINCT d.id) AS total_deployments,
                COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})) AS with_four_eyes,
                COUNT(DISTINCT d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})) AS pending_verification,
                COUNT(DISTINCT d.id) FILTER (WHERE EXISTS (
                  SELECT 1 FROM deployment_goal_links dgl
                  WHERE dgl.deployment_id = d.id AND dgl.is_active = true
                    AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
                )) AS linked_to_goal
         FROM team_deployments td
         JOIN deployments d ON d.id = td.deployment_id
         GROUP BY d.monitored_app_id
       ),
       app_alerts AS (
         SELECT ra.monitored_app_id, COUNT(*) AS alert_count
         FROM team_apps ta
         JOIN repository_alerts ra ON ra.monitored_app_id = ta.id AND ra.resolved_at IS NULL
         GROUP BY ra.monitored_app_id
       )
       SELECT
         (SELECT COUNT(*) FROM team_apps)::int AS total_apps,
         COALESCE(SUM(s.total_deployments), 0)::int AS total_deployments,
         COALESCE(SUM(s.with_four_eyes), 0)::int AS with_four_eyes,
         (COALESCE(SUM(s.total_deployments), 0) - COALESCE(SUM(s.with_four_eyes), 0) - COALESCE(SUM(s.pending_verification), 0))::int AS without_four_eyes,
         COALESCE(SUM(s.pending_verification), 0)::int AS pending_verification,
         COALESCE(SUM(s.linked_to_goal), 0)::int AS linked_to_goal,
         COUNT(*) FILTER (WHERE COALESCE(s.total_deployments, 0) - COALESCE(s.with_four_eyes, 0) - COALESCE(s.pending_verification, 0) > 0 OR COALESCE(s.pending_verification, 0) > 0 OR COALESCE(a.alert_count, 0) > 0 OR (COALESCE(s.total_deployments, 0) > 0 AND COALESCE(s.linked_to_goal, 0) < COALESCE(s.total_deployments, 0)))::int AS apps_with_issues
       FROM team_apps ta
       LEFT JOIN app_stats s ON s.monitored_app_id = ta.id
       LEFT JOIN app_alerts a ON a.monitored_app_id = ta.id`,
      params,
    )

    const row = result.rows[0]
    const total = row?.total_deployments ?? 0
    const withFourEyes = row?.with_four_eyes ?? 0
    const linkedToGoal = row?.linked_to_goal ?? 0

    return {
      total_apps: row?.total_apps ?? 0,
      total_deployments: total,
      with_four_eyes: withFourEyes,
      without_four_eyes: row?.without_four_eyes ?? 0,
      pending_verification: row?.pending_verification ?? 0,
      linked_to_goal: linkedToGoal,
      four_eyes_coverage: total > 0 ? withFourEyes / total : 0,
      goal_coverage: total > 0 ? linkedToGoal / total : 0,
      four_eyes_percentage: total > 0 ? Math.round((withFourEyes / total) * 100) : 0,
      goal_percentage: total > 0 ? Math.round((linkedToGoal / total) * 100) : 0,
      apps_with_issues: row?.apps_with_issues ?? 0,
    }
  }

  const deployerFilterClause = hasDeployerFilter ? ` AND ${userDeploymentMatchAnySql(4, 'd')}` : ''
  if (hasDeployerFilter) params.push(lowerUsernames(deployerUsernames))

  const result = await pool.query(
    `WITH team_apps AS (
       SELECT ma.id, ${effectiveAuditStartYearSql('ma')} AS audit_start_year
       FROM monitored_applications ma
       WHERE ma.is_active = true
         AND (ma.team_slug = ANY($1::text[]) OR ma.id = ANY($2::int[]))
     ),
     app_stats AS (
       SELECT d.monitored_app_id,
              COUNT(d.id) AS total_deployments,
              COUNT(d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})) AS with_four_eyes,
              COUNT(d.id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})) AS pending_verification,
              COUNT(DISTINCT dgl.deployment_id) AS linked_to_goal
       FROM team_apps ta
       JOIN deployments d ON d.monitored_app_id = ta.id
         AND ($3::timestamptz IS NULL OR d.created_at >= $3)
         AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))${deployerFilterClause}
       LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id AND dgl.is_active = true
         AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
       GROUP BY d.monitored_app_id
     ),
     app_alerts AS (
       SELECT ra.monitored_app_id, COUNT(*) AS alert_count
       FROM team_apps ta
       JOIN repository_alerts ra ON ra.monitored_app_id = ta.id AND ra.resolved_at IS NULL
       GROUP BY ra.monitored_app_id
     )
     SELECT
       (SELECT COUNT(*) FROM team_apps)::int AS total_apps,
       COALESCE(SUM(s.total_deployments), 0)::int AS total_deployments,
       COALESCE(SUM(s.with_four_eyes), 0)::int AS with_four_eyes,
       (COALESCE(SUM(s.total_deployments), 0) - COALESCE(SUM(s.with_four_eyes), 0) - COALESCE(SUM(s.pending_verification), 0))::int AS without_four_eyes,
       COALESCE(SUM(s.pending_verification), 0)::int AS pending_verification,
       COALESCE(SUM(s.linked_to_goal), 0)::int AS linked_to_goal,
       COUNT(*) FILTER (WHERE COALESCE(s.total_deployments, 0) - COALESCE(s.with_four_eyes, 0) - COALESCE(s.pending_verification, 0) > 0 OR COALESCE(s.pending_verification, 0) > 0 OR COALESCE(a.alert_count, 0) > 0 OR (COALESCE(s.total_deployments, 0) > 0 AND COALESCE(s.linked_to_goal, 0) < COALESCE(s.total_deployments, 0)))::int AS apps_with_issues
     FROM team_apps ta
     LEFT JOIN app_stats s ON s.monitored_app_id = ta.id
     LEFT JOIN app_alerts a ON a.monitored_app_id = ta.id`,
    params,
  )

  const row = result.rows[0]
  const total = row?.total_deployments ?? 0
  const withFourEyes = row?.with_four_eyes ?? 0
  const linkedToGoal = row?.linked_to_goal ?? 0

  return {
    total_apps: row?.total_apps ?? 0,
    total_deployments: total,
    with_four_eyes: withFourEyes,
    without_four_eyes: row?.without_four_eyes ?? 0,
    pending_verification: row?.pending_verification ?? 0,
    linked_to_goal: linkedToGoal,
    four_eyes_coverage: total > 0 ? withFourEyes / total : 0,
    goal_coverage: total > 0 ? linkedToGoal / total : 0,
    four_eyes_percentage: total > 0 ? Math.round((withFourEyes / total) * 100) : 0,
    goal_percentage: total > 0 ? Math.round((linkedToGoal / total) * 100) : 0,
    apps_with_issues: row?.apps_with_issues ?? 0,
  }
}

export type { BoardObjectiveProgress } from './dashboard-stats/board-objective-progress.server'
export { getBoardObjectiveProgress } from './dashboard-stats/board-objective-progress.server'
export type { DevTeamBatchStats } from './dashboard-stats/team-batch-stats.server'
export {
  getContributedBoards,
  getDevTeamStats,
  getDevTeamStatsBatch,
} from './dashboard-stats/team-batch-stats.server'
