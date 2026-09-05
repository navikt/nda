import type { BoardPeriodType } from '~/lib/board-periods'
import { APPROVED_STATUSES_SQL, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import { pool } from '../connection.server'
import { effectiveAuditStartYearSql } from '../repository-settings-sql'
import { lowerUsernames, userDeploymentMatchAnySql } from '../user-deployment-match'

export interface DevTeamBatchStats {
  dev_team_id: number
  dev_team_name: string
  dev_team_slug: string
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  linked_to_goal: number
  non_member_deployments: number
  four_eyes_coverage: number
  goal_coverage: number
}

export async function getDevTeamStatsBatch(
  devTeamIds: number[],
  startDate: Date,
  endDate?: Date,
): Promise<Map<number, DevTeamBatchStats>> {
  if (devTeamIds.length === 0) return new Map()

  const result = await pool.query<{
    dev_team_id: number
    dev_team_name: string
    dev_team_slug: string
    total_deployments: number
    with_four_eyes: number
    without_four_eyes: number
    pending_verification: number
    linked_to_goal: number
    non_member_deployments: number
  }>(
    `WITH team_members AS (
      SELECT DISTINCT r.dev_team_id, LOWER(uga.github_username) AS github_username
       FROM dev_team_role_assignments r
      JOIN user_github_accounts uga
        ON uga.nav_ident = r.nav_ident AND uga.deleted_at IS NULL
       WHERE r.dev_team_id = ANY($1::int[])
         AND r.deleted_at IS NULL
        AND uga.github_username IS NOT NULL
     ),
     -- Aggregate member usernames per team as an array to avoid fan-out
     -- when joining against deployments in unlinked_member.
     team_member_usernames AS (
       SELECT dev_team_id, array_agg(github_username) AS usernames
       FROM team_members
       GROUP BY dev_team_id
     ),
     team_apps AS (
       SELECT DISTINCT dt.id AS dev_team_id, dt.name AS dev_team_name, dt.slug AS dev_team_slug,
              ma.id AS app_id, ${effectiveAuditStartYearSql('ma')} AS audit_start_year
       FROM dev_teams dt
       LEFT JOIN dev_team_nais_teams dtn ON dtn.dev_team_id = dt.id AND dtn.deleted_at IS NULL
       LEFT JOIN dev_team_applications dta ON dta.dev_team_id = dt.id AND dta.deleted_at IS NULL
       JOIN monitored_applications ma ON ma.is_active = true
         AND (ma.team_slug = dtn.nais_team_slug OR ma.id = dta.monitored_app_id)
       WHERE dt.id = ANY($1::int[]) AND dt.is_active = true
     ),
     -- Pre-compute all deployment IDs linked to any active board (objective or KR path).
     -- Scoped to the $2/$3 date window since unlinked_member only considers deployments
     -- within that window — avoids scanning historical DGL rows that can't affect the result.
     any_board_linked AS (
       SELECT dgl.deployment_id
       FROM deployment_goal_links dgl
       JOIN deployments d ON d.id = dgl.deployment_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
       JOIN board_objectives bo ON bo.id = dgl.objective_id AND bo.is_active = true
       JOIN boards b ON b.id = bo.board_id AND b.is_active = true
       WHERE dgl.is_active = true
       UNION
       SELECT dgl.deployment_id
       FROM deployment_goal_links dgl
       JOIN deployments d ON d.id = dgl.deployment_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
       JOIN board_key_results bkr ON bkr.id = dgl.key_result_id AND bkr.is_active = true
       JOIN board_objectives bo ON bo.id = bkr.objective_id AND bo.is_active = true
       JOIN boards b ON b.id = bo.board_id AND b.is_active = true
       WHERE dgl.is_active = true
     ),
     -- Deployments linked to a team's board via objectives (avoids nested IN subquery)
     board_linked_obj AS (
       SELECT DISTINCT b.dev_team_id, d.id AS deployment_id
       FROM boards b
       JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
       JOIN deployment_goal_links dgl ON dgl.objective_id = bo.id AND dgl.is_active = true
       JOIN deployments d ON d.id = dgl.deployment_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
       JOIN team_apps ta ON ta.dev_team_id = b.dev_team_id AND ta.app_id = d.monitored_app_id
       WHERE b.dev_team_id = ANY($1::int[]) AND b.is_active = true
         AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
     ),
     -- Deployments linked to a team's board via key results (avoids nested IN subquery)
     board_linked_kr AS (
       SELECT DISTINCT b.dev_team_id, d.id AS deployment_id
       FROM boards b
       JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
       JOIN board_key_results bkr ON bkr.objective_id = bo.id AND bkr.is_active = true
       JOIN deployment_goal_links dgl ON dgl.key_result_id = bkr.id AND dgl.is_active = true
       JOIN deployments d ON d.id = dgl.deployment_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
       JOIN team_apps ta ON ta.dev_team_id = b.dev_team_id AND ta.app_id = d.monitored_app_id
       WHERE b.dev_team_id = ANY($1::int[]) AND b.is_active = true
         AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
     ),
     board_linked AS (
       SELECT dev_team_id, deployment_id FROM board_linked_obj
       UNION
       SELECT dev_team_id, deployment_id FROM board_linked_kr
     ),
     -- Unlinked deployments by team members (not linked to ANY active board).
     -- Uses array-based username lookup (1 row per team) instead of
     -- joining team_apps × team_members (N_apps × N_members rows per team).
     unlinked_member AS (
       SELECT DISTINCT ta.dev_team_id, d.id AS deployment_id
       FROM team_apps ta
       JOIN team_member_usernames tmu ON tmu.dev_team_id = ta.dev_team_id
       JOIN deployments d ON d.monitored_app_id = ta.app_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
         AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
         AND (LOWER(d.deployer_username) = ANY(tmu.usernames)
              OR d.pr_creator_username = ANY(tmu.usernames))
       WHERE NOT EXISTS (SELECT 1 FROM any_board_linked abl WHERE abl.deployment_id = d.id)
     ),
     -- Union of both sets (deduplicated per team). MATERIALIZED ensures it is
     -- computed once and reused by both member_deployed and deployment_stats.
     team_deployments AS MATERIALIZED (
       SELECT dev_team_id, deployment_id FROM board_linked
       UNION
       SELECT dev_team_id, deployment_id FROM unlinked_member
     ),
     -- Pre-compute deployments with any active goal link, scoped to team_deployments
     -- to avoid building a global DISTINCT set over all DGL rows.
     linked_goal_deployments AS (
       SELECT DISTINCT td.deployment_id
       FROM team_deployments td
       JOIN deployment_goal_links dgl ON dgl.deployment_id = td.deployment_id
         AND dgl.is_active = true
         AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
     ),
     -- Pre-compute (team, deployment) pairs where the deployer IS a team member
     -- (replaces correlated NOT EXISTS per row in deployment_stats)
     member_deployed AS (
       SELECT DISTINCT td.dev_team_id, td.deployment_id
       FROM team_deployments td
       JOIN deployments d ON d.id = td.deployment_id
       JOIN team_members tm ON tm.dev_team_id = td.dev_team_id
         AND (LOWER(d.deployer_username) = tm.github_username
              OR d.pr_creator_username = tm.github_username)
     ),
     deployment_stats AS (
       SELECT td.dev_team_id,
              COUNT(DISTINCT td.deployment_id)::int AS total_deployments,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL}))::int AS with_four_eyes,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL}))::int AS pending_verification,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE lgd.deployment_id IS NOT NULL)::int AS linked_to_goal,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE md.deployment_id IS NULL)::int AS non_member_deployments
       FROM team_deployments td
       JOIN deployments d ON d.id = td.deployment_id
       LEFT JOIN linked_goal_deployments lgd ON lgd.deployment_id = td.deployment_id
       LEFT JOIN member_deployed md ON md.dev_team_id = td.dev_team_id AND md.deployment_id = td.deployment_id
       GROUP BY td.dev_team_id
     )
     SELECT ta_distinct.dev_team_id, ta_distinct.dev_team_name, ta_distinct.dev_team_slug,
            COALESCE(ds.total_deployments, 0)::int AS total_deployments,
            COALESCE(ds.with_four_eyes, 0)::int AS with_four_eyes,
            COALESCE(ds.total_deployments, 0)::int - COALESCE(ds.with_four_eyes, 0)::int - COALESCE(ds.pending_verification, 0)::int AS without_four_eyes,
            COALESCE(ds.pending_verification, 0)::int AS pending_verification,
            COALESCE(ds.linked_to_goal, 0)::int AS linked_to_goal,
            COALESCE(ds.non_member_deployments, 0)::int AS non_member_deployments
     FROM (SELECT DISTINCT dev_team_id, dev_team_name, dev_team_slug FROM team_apps
           UNION
           SELECT dt.id, dt.name, dt.slug FROM dev_teams dt WHERE dt.id = ANY($1::int[]) AND dt.is_active = true
     ) ta_distinct
     LEFT JOIN deployment_stats ds ON ds.dev_team_id = ta_distinct.dev_team_id
     ORDER BY ta_distinct.dev_team_name`,
    [devTeamIds, startDate, endDate ?? null],
  )

  const map = new Map<number, DevTeamBatchStats>()
  for (const row of result.rows) {
    const total = row.total_deployments
    const withFourEyes = row.with_four_eyes
    const linked = row.linked_to_goal
    map.set(row.dev_team_id, {
      ...row,
      four_eyes_coverage: total > 0 ? withFourEyes / total : 0,
      goal_coverage: total > 0 ? linked / total : 0,
    })
  }
  return map
}

export async function getDevTeamStats(devTeamId: number, startDate: Date, endDate?: Date): Promise<DevTeamBatchStats> {
  const map = await getDevTeamStatsBatch([devTeamId], startDate, endDate)
  return (
    map.get(devTeamId) ?? {
      dev_team_id: devTeamId,
      dev_team_name: '',
      dev_team_slug: '',
      total_deployments: 0,
      with_four_eyes: 0,
      without_four_eyes: 0,
      pending_verification: 0,
      linked_to_goal: 0,
      non_member_deployments: 0,
      four_eyes_coverage: 0,
      goal_coverage: 0,
    }
  )
}

interface ContributedBoard {
  board_id: number
  period_label: string
  period_type: BoardPeriodType
  team_name: string
  team_slug: string
  section_slug: string
  linked_deployment_count: number
}

export async function getContributedBoards(
  excludeDevTeamId: number,
  deployerUsernames: string[],
): Promise<ContributedBoard[]> {
  if (deployerUsernames.length === 0) return []

  const result = await pool.query<ContributedBoard>(
    `SELECT sub.board_id, sub.period_label, sub.period_type,
            sub.team_name, sub.team_slug, sub.section_slug,
            COUNT(DISTINCT sub.deployment_id)::int AS linked_deployment_count
     FROM (
       SELECT b.id AS board_id, b.period_label, b.period_type,
              dt.name AS team_name, dt.slug AS team_slug, s.slug AS section_slug,
              dgl.deployment_id
       FROM boards b
       JOIN dev_teams dt ON dt.id = b.dev_team_id
       JOIN sections s ON s.id = dt.section_id
       JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
       JOIN deployment_goal_links dgl ON dgl.objective_id = bo.id AND dgl.is_active = true
       JOIN deployments d ON d.id = dgl.deployment_id AND ${userDeploymentMatchAnySql(2, 'd')}
       WHERE b.is_active = true AND b.dev_team_id != $1
       UNION
       SELECT b.id, b.period_label, b.period_type,
              dt.name, dt.slug, s.slug,
              dgl.deployment_id
       FROM boards b
       JOIN dev_teams dt ON dt.id = b.dev_team_id
       JOIN sections s ON s.id = dt.section_id
       JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
       JOIN board_key_results bkr ON bkr.objective_id = bo.id AND bkr.is_active = true
       JOIN deployment_goal_links dgl ON dgl.key_result_id = bkr.id AND dgl.is_active = true
       JOIN deployments d ON d.id = dgl.deployment_id AND ${userDeploymentMatchAnySql(2, 'd')}
       WHERE b.is_active = true AND b.dev_team_id != $1
     ) sub
     GROUP BY sub.board_id, sub.period_label, sub.period_type, sub.team_name, sub.team_slug, sub.section_slug
     ORDER BY linked_deployment_count DESC`,
    [excludeDevTeamId, lowerUsernames(deployerUsernames)],
  )
  return result.rows
}
