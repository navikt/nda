import { pool } from '~/db/connection.server'
import type { BoardKeywordSource } from '~/lib/goal-keyword-matcher'

export async function findDevTeamsForDeployment(
  teamSlug: string,
  monitoredAppId: number,
): Promise<Array<{ id: number; name: string }>> {
  const result = await pool.query(
    `SELECT dt.id, dt.name FROM dev_teams dt
     JOIN dev_team_nais_teams dtn ON dtn.dev_team_id = dt.id
     WHERE dtn.nais_team_slug = $1 AND dtn.deleted_at IS NULL AND dt.is_active = true
     UNION
     SELECT dt.id, dt.name FROM dev_teams dt
     JOIN dev_team_applications dta ON dta.dev_team_id = dt.id
     WHERE dta.monitored_app_id = $2 AND dta.deleted_at IS NULL AND dt.is_active = true
     UNION
     SELECT dt.id, dt.name FROM dev_teams dt
     JOIN dev_team_application_groups dtag ON dtag.dev_team_id = dt.id
     JOIN monitored_applications ma ON ma.application_group_id = dtag.application_group_id
     WHERE ma.id = $2 AND dtag.deleted_at IS NULL AND dt.is_active = true`,
    [teamSlug, monitoredAppId],
  )
  return result.rows as Array<{ id: number; name: string }>
}

interface BoardKeywordRow {
  board_id: number
  board_name: string
  period_start: string
  period_end: string
  objective_id: number
  objective_title: string
  key_result_id: number | null
  key_result_title: string | null
  keyword: string
}

export async function loadBoardKeywords(devTeamIds: number[]): Promise<{
  rows: BoardKeywordRow[]
  parsed: BoardKeywordSource[]
}> {
  if (devTeamIds.length === 0) return { rows: [], parsed: [] }

  const result = await pool.query(
    `SELECT
       b.id AS board_id,
       b.title AS board_name,
       b.period_start,
       b.period_end,
       bo.id AS objective_id,
       bo.title AS objective_title,
       NULL::int AS key_result_id,
       NULL::text AS key_result_title,
       unnest(bo.keywords) AS keyword
     FROM boards b
     JOIN board_objectives bo ON bo.board_id = b.id
     WHERE b.dev_team_id = ANY($1) AND b.is_active = true AND bo.is_active = true AND array_length(bo.keywords, 1) > 0
     UNION ALL
     SELECT
       b.id AS board_id,
       b.title AS board_name,
       b.period_start,
       b.period_end,
       bo.id AS objective_id,
       bo.title AS objective_title,
       bkr.id AS key_result_id,
       bkr.title AS key_result_title,
       unnest(bkr.keywords) AS keyword
     FROM boards b
     JOIN board_objectives bo ON bo.board_id = b.id
     JOIN board_key_results bkr ON bkr.objective_id = bo.id
     WHERE b.dev_team_id = ANY($1) AND b.is_active = true AND bo.is_active = true AND bkr.is_active = true AND array_length(bkr.keywords, 1) > 0`,
    [devTeamIds],
  )

  const rows = result.rows as BoardKeywordRow[]
  const parsed: BoardKeywordSource[] = rows.map((r) => ({
    boardId: r.board_id,
    periodStart: new Date(r.period_start),
    periodEnd: new Date(r.period_end),
    objectiveId: r.objective_id,
    keyResultId: r.key_result_id,
    keyword: r.keyword,
  }))

  return { rows, parsed }
}
