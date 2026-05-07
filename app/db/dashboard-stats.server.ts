import { APPROVED_STATUSES_SQL, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'
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

export interface BoardObjectiveProgress {
  objective_id: number
  objective_title: string
  keywords: string[]
  dependabot_target: boolean
  key_results: {
    id: number
    title: string
    linked_deployments: number
    keywords: string[]
    dependabot_target: boolean
  }[]
  total_linked_deployments: number
}

interface BoardProgressResult {
  objectives: BoardObjectiveProgress[]
  /** Total distinct deployments linked to any objective/KR on the board (no double-counting) */
  totalDistinctDeployments: number
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

/**
 * Get overall section stats using section_teams for the full picture.
 * This includes ALL deployments for nais teams in the section, regardless of dev team assignment.
 */
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

/**
 * Get dashboard stats for all dev teams in a section within a date range.
 * The per-team scope is the **union** of direct app links
 * (dev_team_applications) and nais team links (dev_team_nais_teams), so a
 * deployment is counted if it matches either side.
 */
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

/**
 * Get summary stats for dev team(s).
 *
 * Operates in two modes depending on whether `devTeamId` is provided:
 *
 * ## Board-based mode (when `devTeamId` is set)
 * A deployment belongs to the team if:
 * 1. It is linked (via deployment_goal_links) to an active objective/KR on one
 *    of the team's active boards, OR
 * 2. It is NOT linked to any active board and the deployer/PR-creator is a team
 *    member (identified via `deployerUsernames`)
 *
 * When `devTeamId` is an array, boards from ALL provided teams are considered
 * and deployments are deduplicated (counted once even if linked to multiple
 * teams' boards). This is used by `/my-teams`.
 *
 * `deployerUsernames` is optional in this mode — if undefined/empty, only
 * board-linked deployments are counted (the unlinked-member path is skipped).
 *
 * ## Legacy deployer-based mode (when `devTeamId` is omitted)
 * Falls back to counting all deployments on team apps filtered by deployer
 * usernames. Used by the Slack home tab where board context is unavailable.
 *
 * @param naisTeamSlugs - NAIS team slugs that define app ownership
 * @param directAppIds - Additional directly-linked app IDs
 * @param startDate - Optional start date filter (e.g. YTD)
 * @param deployerUsernames - Team member GitHub usernames (for unlinked-member path)
 * @param devTeamId - Single or multiple dev team IDs to enable board-based counting
 */
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

  // If we have devTeamId(s), use board-based counting
  const devTeamIds = devTeamId !== undefined ? (Array.isArray(devTeamId) ? devTeamId : [devTeamId]) : undefined
  if (devTeamIds !== undefined) {
    params.push(devTeamIds)
    const devTeamIdParam = params.length
    const effectiveDeployers = deployerUsernames ?? []
    params.push(lowerUsernames(effectiveDeployers))
    const deployerParam = params.length

    const result = await pool.query(
      `WITH team_apps AS (
         SELECT ma.id, ma.audit_start_year
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
                OR LOWER(d.github_pr_data->'creator'->>'username') = ANY($${deployerParam}::text[]))
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

  // Fallback: original deployer-based logic when no devTeamId provided
  const deployerFilterClause = hasDeployerFilter ? ` AND ${userDeploymentMatchAnySql(4, 'd')}` : ''
  if (hasDeployerFilter) params.push(lowerUsernames(deployerUsernames))

  const result = await pool.query(
    `WITH team_apps AS (
       SELECT ma.id, ma.audit_start_year
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

/**
 * Get objective progress for a board — how many deployments are linked to each objective/key result.
 *
 * When `deployerUsernames` is provided, only deployments made by those users
 * (deployer or PR creator) are counted. This keeps counts consistent with the
 * team-member-filtered stats shown on team pages and section pages.
 *
 * Implementation: 3 queries total (objectives, all KR-linked deployment
 * counts via ANY($1::int[]), all objective-linked deployment counts via
 * ANY($1::int[])) regardless of objective/key-result count.
 */
export async function getBoardObjectiveProgress(
  boardId: number,
  deployerUsernames?: string[],
  options?: { startDate?: Date },
): Promise<BoardProgressResult> {
  const objectivesResult = await pool.query(
    `SELECT id, title, COALESCE(keywords, '{}'::text[]) AS keywords, dependabot_target
     FROM board_objectives WHERE board_id = $1 AND is_active = true ORDER BY sort_order, id`,
    [boardId],
  )
  const objectiveIds = objectivesResult.rows.map((o) => o.id as number)
  if (objectiveIds.length === 0) return { objectives: [], totalDistinctDeployments: 0 }

  const hasDeployerFilter = deployerUsernames !== undefined && deployerUsernames.length > 0
  // Always join deployments when we need deployer filter OR date filter
  const needsDeploymentJoin = hasDeployerFilter || options?.startDate
  const deployerJoin = needsDeploymentJoin ? ' JOIN deployments d ON d.id = dgl.deployment_id' : ''

  const baseParams: any[] = [objectiveIds]
  let paramIndex = 2
  let filterWhere = ''

  if (hasDeployerFilter) {
    filterWhere += ` AND ${userDeploymentMatchAnySql(paramIndex, 'd')}`
    baseParams.push(lowerUsernames(deployerUsernames))
    paramIndex++
  }
  if (options?.startDate) {
    filterWhere += ` AND d.created_at >= $${paramIndex}`
    baseParams.push(options.startDate)
    paramIndex++
  }

  // For the KR query we need all key results (even those with 0 links).
  // When filtering by deployer or date, the deployment join and filters
  // must be inside the LEFT JOIN condition — otherwise the INNER JOIN on
  // deployments converts the LEFT JOIN into an effective INNER JOIN,
  // hiding KRs with no matching deployments.
  const krLeftJoin = needsDeploymentJoin
    ? `LEFT JOIN (deployment_goal_links dgl JOIN deployments d ON d.id = dgl.deployment_id) ON dgl.key_result_id = bkr.id AND dgl.is_active = true${filterWhere}`
    : 'LEFT JOIN deployment_goal_links dgl ON dgl.key_result_id = bkr.id AND dgl.is_active = true'

  const krResult = await pool.query(
    `SELECT bkr.id, bkr.objective_id, bkr.title, bkr.sort_order,
            COALESCE(bkr.keywords, '{}'::text[]) AS keywords, bkr.dependabot_target,
            COUNT(DISTINCT dgl.deployment_id) AS linked_deployments
     FROM board_key_results bkr
     ${krLeftJoin}
     WHERE bkr.objective_id = ANY($1::int[]) AND bkr.is_active = true
     GROUP BY bkr.id, bkr.objective_id, bkr.title, bkr.sort_order, bkr.keywords, bkr.dependabot_target
     ORDER BY bkr.sort_order, bkr.id`,
    baseParams,
  )

  // Count distinct deployments linked to objectives directly
  const objLinksResult = await pool.query(
    `SELECT dgl.objective_id, COUNT(DISTINCT dgl.deployment_id) AS cnt
     FROM deployment_goal_links dgl${deployerJoin}
     WHERE dgl.objective_id = ANY($1::int[]) AND dgl.is_active = true${filterWhere}
     GROUP BY dgl.objective_id`,
    baseParams,
  )

  // Count distinct deployments linked via KRs per objective (avoids double-counting
  // when a deployment is linked to multiple KRs under the same objective)
  const krDistinctResult = await pool.query(
    `SELECT bkr.objective_id, COUNT(DISTINCT dgl.deployment_id) AS cnt
     FROM deployment_goal_links dgl
     JOIN board_key_results bkr ON bkr.id = dgl.key_result_id AND bkr.is_active = true${deployerJoin}
     WHERE bkr.objective_id = ANY($1::int[]) AND dgl.is_active = true${filterWhere}
     GROUP BY bkr.objective_id`,
    baseParams,
  )

  const krsByObjective = new Map<
    number,
    Array<{ id: number; title: string; linked_deployments: number; keywords: string[]; dependabot_target: boolean }>
  >()
  for (const kr of krResult.rows) {
    const linked = Number(kr.linked_deployments)
    const list = krsByObjective.get(kr.objective_id) ?? []
    list.push({
      id: kr.id,
      title: kr.title,
      linked_deployments: linked,
      keywords: kr.keywords,
      dependabot_target: kr.dependabot_target,
    })
    krsByObjective.set(kr.objective_id, list)
  }

  const objLinksByObjective = new Map<number, number>()
  for (const row of objLinksResult.rows) {
    objLinksByObjective.set(row.objective_id as number, Number(row.cnt))
  }

  const krDistinctByObjective = new Map<number, number>()
  for (const row of krDistinctResult.rows) {
    krDistinctByObjective.set(row.objective_id as number, Number(row.cnt))
  }

  // Total distinct deployments linked to this board (across all objectives and KRs, no double-counting)
  const totalDistinctResult = await pool.query(
    `SELECT COUNT(DISTINCT dgl.deployment_id)::int AS cnt
     FROM deployment_goal_links dgl${deployerJoin}
     WHERE dgl.is_active = true${filterWhere}
       AND (dgl.objective_id = ANY($1::int[])
            OR dgl.key_result_id IN (
              SELECT bkr.id FROM board_key_results bkr
              WHERE bkr.objective_id = ANY($1::int[]) AND bkr.is_active = true
            ))`,
    baseParams,
  )
  const totalDistinctDeployments = Number(totalDistinctResult.rows[0]?.cnt ?? 0)

  return {
    objectives: objectivesResult.rows.map((obj) => ({
      objective_id: obj.id,
      objective_title: obj.title,
      keywords: obj.keywords as string[],
      dependabot_target: obj.dependabot_target as boolean,
      key_results: krsByObjective.get(obj.id) ?? [],
      total_linked_deployments: (objLinksByObjective.get(obj.id) ?? 0) + (krDistinctByObjective.get(obj.id) ?? 0),
    })),
    totalDistinctDeployments,
  }
}

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

/**
 * Batch-compute per-team deployment stats using board-based ownership.
 *
 * A deployment belongs to a team if:
 * 1. It is linked (via deployment_goal_links) to one of the team's boards, OR
 * 2. It is NOT linked to ANY board and the deployer/PR-creator is a team member
 *
 * Deduplication: a deployment linked to multiple boards of the same team
 * is counted only once. Cross-team: a deployment linked to boards of multiple
 * teams counts for each team.
 *
 * Returns a Map keyed by dev_team_id. Also includes `non_member_deployments`
 * (deployments counted because of board-linking but deployer is NOT a team member).
 */
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
       SELECT p.dev_team_id, LOWER(um.github_username) AS github_username
       FROM user_dev_team_preference p
       JOIN user_mappings um
         ON UPPER(um.nav_ident) = UPPER(p.nav_ident) AND um.deleted_at IS NULL
       WHERE p.dev_team_id = ANY($1::int[])
         AND um.github_username IS NOT NULL
     ),
     team_apps AS (
       SELECT dt.id AS dev_team_id, dt.name AS dev_team_name, dt.slug AS dev_team_slug,
              ma.id AS app_id, ma.audit_start_year
       FROM dev_teams dt
       LEFT JOIN dev_team_nais_teams dtn ON dtn.dev_team_id = dt.id AND dtn.deleted_at IS NULL
       LEFT JOIN dev_team_applications dta ON dta.dev_team_id = dt.id AND dta.deleted_at IS NULL
       JOIN monitored_applications ma ON ma.is_active = true
         AND (ma.team_slug = dtn.nais_team_slug OR ma.id = dta.monitored_app_id)
       WHERE dt.id = ANY($1::int[]) AND dt.is_active = true
       GROUP BY dt.id, dt.name, dt.slug, ma.id, ma.audit_start_year
     ),
     -- Deployments linked to a team's board (via objectives or key results)
     board_linked AS (
       SELECT DISTINCT b.dev_team_id, d.id AS deployment_id
       FROM boards b
       JOIN board_objectives bo ON bo.board_id = b.id AND bo.is_active = true
       JOIN deployment_goal_links dgl ON dgl.is_active = true
         AND (dgl.objective_id = bo.id
              OR dgl.key_result_id IN (SELECT bkr.id FROM board_key_results bkr WHERE bkr.objective_id = bo.id AND bkr.is_active = true))
       JOIN deployments d ON d.id = dgl.deployment_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
       JOIN team_apps ta ON ta.dev_team_id = b.dev_team_id AND ta.app_id = d.monitored_app_id
       WHERE b.dev_team_id = ANY($1::int[]) AND b.is_active = true
         AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
     ),
     -- Unlinked deployments by team members (not linked to ANY board)
     unlinked_member AS (
       SELECT ta.dev_team_id, d.id AS deployment_id
       FROM team_apps ta
       JOIN team_members tm ON tm.dev_team_id = ta.dev_team_id
       JOIN deployments d ON d.monitored_app_id = ta.app_id
         AND d.created_at >= $2
         AND ($3::timestamptz IS NULL OR d.created_at < $3)
         AND (ta.audit_start_year IS NULL OR d.created_at >= make_date(ta.audit_start_year, 1, 1))
         AND (LOWER(d.deployer_username) = tm.github_username
              OR LOWER(d.github_pr_data->'creator'->>'username') = tm.github_username)
       WHERE NOT EXISTS (
         SELECT 1 FROM deployment_goal_links dgl
         JOIN board_objectives bo ON (dgl.objective_id = bo.id
           OR dgl.key_result_id IN (SELECT bkr.id FROM board_key_results bkr WHERE bkr.objective_id = bo.id AND bkr.is_active = true))
         JOIN boards b ON b.id = bo.board_id AND b.is_active = true
         WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND bo.is_active = true
       )
     ),
     -- Union of both sets (deduplicated per team)
     team_deployments AS (
       SELECT dev_team_id, deployment_id FROM board_linked
       UNION
       SELECT dev_team_id, deployment_id FROM unlinked_member
     ),
     deployment_stats AS (
       SELECT td.dev_team_id,
              COUNT(DISTINCT td.deployment_id)::int AS total_deployments,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL}))::int AS with_four_eyes,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL}))::int AS pending_verification,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE EXISTS (
                SELECT 1 FROM deployment_goal_links dgl
                WHERE dgl.deployment_id = td.deployment_id AND dgl.is_active = true
                  AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
              ))::int AS linked_to_goal,
              COUNT(DISTINCT td.deployment_id) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM team_members tm
                WHERE tm.dev_team_id = td.dev_team_id
                  AND (LOWER(d.deployer_username) = tm.github_username
                       OR LOWER(d.github_pr_data->'creator'->>'username') = tm.github_username)
              ))::int AS non_member_deployments
       FROM team_deployments td
       JOIN deployments d ON d.id = td.deployment_id
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

/**
 * Get deployment stats for a single team using board-based ownership.
 * Convenience wrapper around `getDevTeamStatsBatch` for use on team pages.
 */
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
  period_type: 'tertiary' | 'quarterly'
  team_name: string
  team_slug: string
  section_slug: string
  linked_deployment_count: number
}

/**
 * Find active boards from other teams where the given deployers have
 * deployments linked via `deployment_goal_links`.
 */
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
