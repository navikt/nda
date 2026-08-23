import { pool } from '../connection.server'
import { lowerUsernames, userDeploymentMatchAnySql } from '../user-deployment-match'

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
  totalDistinctDeployments: number
}

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

  const combinedLinksResult = await pool.query(
    `SELECT combined.objective_id, COUNT(DISTINCT combined.deployment_id)::int AS cnt
     FROM (
       SELECT dgl.objective_id, dgl.deployment_id
       FROM deployment_goal_links dgl${deployerJoin}
       WHERE dgl.objective_id = ANY($1::int[]) AND dgl.is_active = true${filterWhere}
       UNION ALL
       SELECT bkr.objective_id, dgl.deployment_id
       FROM deployment_goal_links dgl
       JOIN board_key_results bkr ON bkr.id = dgl.key_result_id AND bkr.is_active = true${deployerJoin}
       WHERE bkr.objective_id = ANY($1::int[]) AND dgl.is_active = true${filterWhere}
     ) combined
     GROUP BY combined.objective_id`,
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

  const combinedByObjective = new Map<number, number>()
  for (const row of combinedLinksResult.rows) {
    combinedByObjective.set(row.objective_id as number, Number(row.cnt))
  }

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
      total_linked_deployments: combinedByObjective.get(obj.id) ?? 0,
    })),
    totalDistinctDeployments,
  }
}
