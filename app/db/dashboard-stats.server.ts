import { pool } from './connection.server'

interface SectionOverallStats {
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  linked_to_goal: number
  four_eyes_coverage: number
  goal_coverage: number
}

export interface DevTeamDashboardStats {
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
  key_results: {
    id: number
    title: string
    linked_deployments: number
  }[]
  total_linked_deployments: number
}

/**
 * Get overall section stats using section_teams for the full picture.
 * This includes ALL deployments for nais teams in the section, regardless of dev team assignment.
 */
export async function getSectionOverallStats(
  sectionId: number,
  startDate: Date,
  endDate: Date,
): Promise<SectionOverallStats> {
  const result = await pool.query(
    `SELECT
       COUNT(d.id)::int AS total_deployments,
       COUNT(d.id) FILTER (WHERE d.has_four_eyes = true)::int AS with_four_eyes,
       COUNT(d.id) FILTER (WHERE d.four_eyes_status IN ('direct_push', 'unverified_commits', 'approved_pr_with_unreviewed', 'unauthorized_repository', 'unauthorized_branch'))::int AS without_four_eyes,
       COUNT(d.id) FILTER (WHERE d.four_eyes_status IN ('pending', 'pending_baseline', 'pending_approval', 'unknown'))::int AS pending_verification,
       COUNT(DISTINCT dgl.deployment_id)::int AS linked_to_goal
     FROM section_teams st
     JOIN deployments d ON d.team_slug = st.team_slug
       AND d.created_at >= $2 AND d.created_at < $3
     LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
     WHERE st.section_id = $1`,
    [sectionId, startDate, endDate],
  )

  const row = result.rows[0]
  const total = row?.total_deployments ?? 0
  const withFourEyes = row?.with_four_eyes ?? 0
  const linked = row?.linked_to_goal ?? 0

  return {
    total_deployments: total,
    with_four_eyes: withFourEyes,
    without_four_eyes: row?.without_four_eyes ?? 0,
    pending_verification: row?.pending_verification ?? 0,
    linked_to_goal: linked,
    four_eyes_coverage: total > 0 ? withFourEyes / total : 0,
    goal_coverage: total > 0 ? linked / total : 0,
  }
}

/**
 * Get dashboard stats for all dev teams in a section within a date range.
 * Uses direct app links (dev_team_applications) when available, falling back to nais team links.
 */
export async function getSectionDashboardStats(
  sectionId: number,
  startDate: Date,
  endDate: Date,
): Promise<DevTeamDashboardStats[]> {
  const result = await pool.query(
    `WITH team_apps AS (
       -- Direct app links
       SELECT dt.id AS dev_team_id, dt.name AS dev_team_name, dt.slug AS dev_team_slug,
              COALESCE(array_agg(DISTINCT dtn.nais_team_slug) FILTER (WHERE dtn.nais_team_slug IS NOT NULL), '{}') AS nais_team_slugs,
              array_agg(DISTINCT dta.monitored_app_id) FILTER (WHERE dta.monitored_app_id IS NOT NULL) AS direct_app_ids
       FROM dev_teams dt
       LEFT JOIN dev_team_nais_teams dtn ON dtn.dev_team_id = dt.id
       LEFT JOIN dev_team_applications dta ON dta.dev_team_id = dt.id
       WHERE dt.section_id = $1 AND dt.is_active = true
       GROUP BY dt.id
     ),
     deployment_stats AS (
       SELECT ta.dev_team_id,
              COUNT(d.id) AS total_deployments,
              COUNT(d.id) FILTER (WHERE d.has_four_eyes = true) AS with_four_eyes,
              COUNT(d.id) FILTER (WHERE d.four_eyes_status IN ('direct_push', 'unverified_commits', 'approved_pr_with_unreviewed', 'unauthorized_repository', 'unauthorized_branch')) AS without_four_eyes,
              COUNT(d.id) FILTER (WHERE d.four_eyes_status IN ('pending', 'pending_baseline', 'pending_approval', 'unknown')) AS pending_verification,
              COUNT(DISTINCT dgl.deployment_id) AS linked_to_goal
       FROM team_apps ta
       LEFT JOIN deployments d ON (
         CASE
           WHEN ta.direct_app_ids IS NOT NULL THEN d.monitored_app_id = ANY(ta.direct_app_ids)
           ELSE d.team_slug = ANY(ta.nais_team_slugs)
         END
       ) AND d.created_at >= $2 AND d.created_at < $3
       LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
       GROUP BY ta.dev_team_id
     )
     SELECT ta.dev_team_id, ta.dev_team_name, ta.dev_team_slug,
            ta.nais_team_slugs,
            COALESCE(ds.total_deployments, 0)::int AS total_deployments,
            COALESCE(ds.with_four_eyes, 0)::int AS with_four_eyes,
            COALESCE(ds.without_four_eyes, 0)::int AS without_four_eyes,
            COALESCE(ds.pending_verification, 0)::int AS pending_verification,
            COALESCE(ds.linked_to_goal, 0)::int AS linked_to_goal
     FROM team_apps ta
     LEFT JOIN deployment_stats ds ON ds.dev_team_id = ta.dev_team_id
     ORDER BY ta.dev_team_name`,
    [sectionId, startDate, endDate],
  )

  return result.rows.map((row) => ({
    ...row,
    four_eyes_coverage: row.total_deployments > 0 ? row.with_four_eyes / row.total_deployments : 0,
    goal_coverage: row.total_deployments > 0 ? row.linked_to_goal / row.total_deployments : 0,
  }))
}

/**
 * Get objective progress for a board — how many deployments are linked to each objective/key result.
 */
export async function getBoardObjectiveProgress(boardId: number): Promise<BoardObjectiveProgress[]> {
  const objectives = await pool.query(
    'SELECT id, title FROM board_objectives WHERE board_id = $1 ORDER BY sort_order, id',
    [boardId],
  )

  const result: BoardObjectiveProgress[] = []

  for (const obj of objectives.rows) {
    const krResult = await pool.query(
      `SELECT bkr.id, bkr.title,
              COUNT(DISTINCT dgl.deployment_id) AS linked_deployments
       FROM board_key_results bkr
       LEFT JOIN deployment_goal_links dgl ON dgl.key_result_id = bkr.id
       WHERE bkr.objective_id = $1
       GROUP BY bkr.id, bkr.title
       ORDER BY bkr.sort_order, bkr.id`,
      [obj.id],
    )

    const objLinks = await pool.query(
      'SELECT COUNT(DISTINCT deployment_id) AS cnt FROM deployment_goal_links WHERE objective_id = $1',
      [obj.id],
    )

    const krLinkedTotal = krResult.rows.reduce(
      (sum: number, kr: { linked_deployments: string }) => sum + Number(kr.linked_deployments),
      0,
    )

    result.push({
      objective_id: obj.id,
      objective_title: obj.title,
      key_results: krResult.rows.map((kr) => ({
        id: kr.id,
        title: kr.title,
        linked_deployments: Number(kr.linked_deployments),
      })),
      total_linked_deployments: Number(objLinks.rows[0]?.cnt ?? 0) + krLinkedTotal,
    })
  }

  return result
}
