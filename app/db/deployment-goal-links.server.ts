import { pool } from './connection.server'

export interface DeploymentGoalLink {
  id: number
  deployment_id: number
  objective_id: number | null
  key_result_id: number | null
  external_url: string | null
  external_url_title: string | null
  link_method: 'manual' | 'slack' | 'commit_keyword' | 'pr_title'
  linked_by: string | null
  created_at: string
}

export interface DeploymentGoalLinkWithDetails extends DeploymentGoalLink {
  objective_title: string | null
  key_result_title: string | null
  board_title: string | null
  board_period_label: string | null
}

export async function getLinksForDeployment(deploymentId: number): Promise<DeploymentGoalLinkWithDetails[]> {
  const result = await pool.query(
    `SELECT dgl.*,
       bo.title AS objective_title,
       bkr.title AS key_result_title,
       b.title AS board_title,
       b.period_label AS board_period_label
     FROM deployment_goal_links dgl
     LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
     LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
     LEFT JOIN boards b ON b.id = bo.board_id OR b.id = (SELECT bo2.board_id FROM board_objectives bo2 WHERE bo2.id = bkr.objective_id)
     WHERE dgl.deployment_id = $1
     ORDER BY dgl.created_at DESC`,
    [deploymentId],
  )
  return result.rows
}

export async function addDeploymentGoalLink(data: {
  deployment_id: number
  objective_id?: number
  key_result_id?: number
  external_url?: string
  external_url_title?: string
  link_method: DeploymentGoalLink['link_method']
  linked_by?: string
}): Promise<DeploymentGoalLink> {
  const result = await pool.query(
    `INSERT INTO deployment_goal_links (deployment_id, objective_id, key_result_id, external_url, external_url_title, link_method, linked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.deployment_id,
      data.objective_id ?? null,
      data.key_result_id ?? null,
      data.external_url ?? null,
      data.external_url_title ?? null,
      data.link_method,
      data.linked_by ?? null,
    ],
  )
  return result.rows[0]
}

export async function removeDeploymentGoalLink(id: number): Promise<void> {
  await pool.query('DELETE FROM deployment_goal_links WHERE id = $1', [id])
}

/** Get origin-of-change coverage stats for a dev team in a date range. */
export async function getOriginOfChangeCoverage(
  naisTeamSlugs: string[],
  startDate: Date,
  endDate: Date,
): Promise<{ total: number; linked: number; coverage: number }> {
  if (naisTeamSlugs.length === 0) return { total: 0, linked: 0, coverage: 0 }

  const placeholders = naisTeamSlugs.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT d.id) AS total,
       COUNT(DISTINCT dgl.deployment_id) AS linked
     FROM deployments d
     LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
     WHERE d.team_slug IN (${placeholders})
       AND d.deployed_at >= $${naisTeamSlugs.length + 1}
       AND d.deployed_at < $${naisTeamSlugs.length + 2}`,
    [...naisTeamSlugs, startDate, endDate],
  )

  const total = Number(result.rows[0]?.total ?? 0)
  const linked = Number(result.rows[0]?.linked ?? 0)
  return { total, linked, coverage: total > 0 ? linked / total : 0 }
}
