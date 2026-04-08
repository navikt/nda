import { pool } from '~/db/connection.server'
import { addDeploymentGoalLink } from '~/db/deployment-goal-links.server'
import { type BoardKeywordSource, type CommitInfo, matchCommitKeywords } from '~/lib/goal-keyword-matcher'
import { logger } from '~/lib/logger.server'

/**
 * Auto-link a deployment to board goals based on commit message keywords.
 *
 * Finds the dev team(s) for the deployment, loads active board keywords,
 * matches against commit messages, and creates goal links for unambiguous matches.
 *
 * Skips if no keywords are configured or no matches found.
 */
export async function autoLinkGoalKeywords(
  deploymentId: number,
  teamSlug: string,
  commitMessages: CommitInfo[],
): Promise<number> {
  if (commitMessages.length === 0) return 0

  // Find dev teams linked to this nais team
  const devTeamResult = await pool.query(
    `SELECT dt.id FROM dev_teams dt
     JOIN dev_team_nais_teams dtn ON dtn.dev_team_id = dt.id
     WHERE dtn.nais_team_slug = $1 AND dt.is_active = true`,
    [teamSlug],
  )

  if (devTeamResult.rows.length === 0) return 0
  const devTeamIds = devTeamResult.rows.map((r: { id: number }) => r.id)

  // Load all board keywords for these dev teams (active boards only)
  const keywordsResult = await pool.query(
    `SELECT
       b.id AS board_id,
       b.period_start,
       b.period_end,
       bo.id AS objective_id,
       NULL::int AS key_result_id,
       unnest(bo.keywords) AS keyword
     FROM boards b
     JOIN board_objectives bo ON bo.board_id = b.id
     WHERE b.dev_team_id = ANY($1) AND b.is_active = true AND array_length(bo.keywords, 1) > 0
     UNION ALL
     SELECT
       b.id AS board_id,
       b.period_start,
       b.period_end,
       bo.id AS objective_id,
       bkr.id AS key_result_id,
       unnest(bkr.keywords) AS keyword
     FROM boards b
     JOIN board_objectives bo ON bo.board_id = b.id
     JOIN board_key_results bkr ON bkr.objective_id = bo.id
     WHERE b.dev_team_id = ANY($1) AND b.is_active = true AND array_length(bkr.keywords, 1) > 0`,
    [devTeamIds],
  )

  if (keywordsResult.rows.length === 0) return 0

  const boardKeywords: BoardKeywordSource[] = keywordsResult.rows.map(
    (r: {
      board_id: number
      period_start: string
      period_end: string
      objective_id: number
      key_result_id: number | null
      keyword: string
    }) => ({
      boardId: r.board_id,
      periodStart: new Date(r.period_start),
      periodEnd: new Date(r.period_end),
      objectiveId: r.objective_id,
      keyResultId: r.key_result_id,
      keyword: r.keyword,
    }),
  )

  // Run pure matching logic
  const matches = matchCommitKeywords(commitMessages, boardKeywords)
  if (matches.length === 0) return 0

  // Check for existing links to avoid duplicates
  const existingResult = await pool.query(
    `SELECT objective_id, key_result_id FROM deployment_goal_links WHERE deployment_id = $1`,
    [deploymentId],
  )
  const existingKeys = new Set(
    existingResult.rows.map(
      (r: { objective_id: number | null; key_result_id: number | null }) =>
        `${r.objective_id ?? ''}:${r.key_result_id ?? ''}`,
    ),
  )

  let linked = 0
  for (const match of matches) {
    const key = `${match.objectiveId}:${match.keyResultId ?? ''}`
    if (existingKeys.has(key)) continue

    await addDeploymentGoalLink({
      deployment_id: deploymentId,
      objective_id: match.objectiveId,
      key_result_id: match.keyResultId ?? undefined,
      link_method: 'commit_keyword',
    })

    existingKeys.add(key)
    linked++
    logger.info(
      `🔗 Auto-linked deployment ${deploymentId} to objective ${match.objectiveId} via keyword "${match.keyword}"`,
    )
  }

  return linked
}
