import { loadDependabotTargets } from '~/db/boards.server'
import { pool } from '~/db/connection.server'
import { addDeploymentGoalLink } from '~/db/deployment-goal-links.server'
import { type CommitInfo, matchCommitKeywords, pickLatestBoard } from '~/lib/goal-keyword-matcher'
import { logger } from '~/lib/logger.server'
import { findDevTeamsForDeployment, loadBoardKeywords } from './goal-keyword-helpers.server'

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
  monitoredAppId: number,
  commitMessages: CommitInfo[],
): Promise<number> {
  if (commitMessages.length === 0) return 0

  const devTeams = await findDevTeamsForDeployment(teamSlug, monitoredAppId)
  if (devTeams.length === 0) return 0
  const devTeamIds = devTeams.map((r) => r.id)

  const { parsed: boardKeywords } = await loadBoardKeywords(devTeamIds)
  if (boardKeywords.length === 0) return 0

  // Run pure matching logic
  const matches = matchCommitKeywords(commitMessages, boardKeywords)
  if (matches.length === 0) return 0

  // Check for existing links to avoid duplicates
  const existingResult = await pool.query(
    `SELECT objective_id, key_result_id FROM deployment_goal_links WHERE deployment_id = $1 AND is_active = true`,
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

    const result = await addDeploymentGoalLink({
      deployment_id: deploymentId,
      objective_id: match.objectiveId,
      key_result_id: match.keyResultId ?? undefined,
      link_method: 'commit_keyword',
    })
    if (!result) continue

    existingKeys.add(key)
    linked++
    logger.info(
      `🔗 Auto-linked deployment ${deploymentId} to objective ${match.objectiveId} via keyword "${match.keyword}"`,
    )
  }

  return linked
}

/**
 * Auto-link a Dependabot deployment to a board goal marked as the Dependabot target.
 *
 * Follows the same rules as keyword linking:
 * - Finds dev teams for the deployment
 * - Loads Dependabot targets from active boards covering the deployment date
 * - If multiple boards have targets, the one with the latest periodStart wins
 * - Skips if the same link (same objective/KR) already exists
 */
export async function autoLinkDependabotGoal(
  deploymentId: number,
  teamSlug: string,
  monitoredAppId: number,
  deploymentDate: Date,
): Promise<number> {
  const devTeams = await findDevTeamsForDeployment(teamSlug, monitoredAppId)
  if (devTeams.length === 0) return 0
  const devTeamIds = devTeams.map((r) => r.id)

  const targets = await loadDependabotTargets(devTeamIds, deploymentDate)
  if (targets.length === 0) return 0

  const target = pickLatestBoard(targets)
  if (!target) return 0

  const link = await addDeploymentGoalLink({
    deployment_id: deploymentId,
    objective_id: target.objectiveId,
    key_result_id: target.keyResultId ?? undefined,
    link_method: 'dependabot_auto',
  })
  if (!link) return 0

  logger.info(
    `🤖 Auto-linked Dependabot deployment ${deploymentId} to objective ${target.objectiveId}${target.keyResultId ? ` / KR ${target.keyResultId}` : ''}`,
  )

  return 1
}
