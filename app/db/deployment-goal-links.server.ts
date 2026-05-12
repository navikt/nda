import { APPROVED_STATUSES } from '~/lib/four-eyes-status'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'
import { lowerUsernames, userDeploymentMatchAnySql, userDeploymentMatchSql } from './user-deployment-match'

export interface DeploymentGoalLink {
  id: number
  deployment_id: number
  objective_id: number | null
  key_result_id: number | null
  external_url: string | null
  external_url_title: string | null
  comment: string | null
  link_method: 'manual' | 'slack' | 'commit_keyword' | 'pr_title' | 'dependabot_auto'
  linked_by: string | null
  is_active: boolean
  created_at: string
}

export interface DeploymentGoalLinkWithDetails extends DeploymentGoalLink {
  objective_title: string | null
  key_result_title: string | null
  board_period_label: string | null
  board_period_type: string | null
  dev_team_slug: string | null
  section_slug: string | null
  objective_is_active: boolean | null
  key_result_is_active: boolean | null
}

export async function getLinksForDeployment(deploymentId: number): Promise<DeploymentGoalLinkWithDetails[]> {
  const result = await pool.query(
    `SELECT dgl.*,
       COALESCE(bo.title, bo_via_kr.title) AS objective_title,
       bkr.title AS key_result_title,
       COALESCE(b.period_label, b_via_kr.period_label) AS board_period_label,
       COALESCE(b.period_type, b_via_kr.period_type) AS board_period_type,
       dt.slug AS dev_team_slug,
       s.slug AS section_slug,
       COALESCE(bo.is_active, bo_via_kr.is_active) AS objective_is_active,
       bkr.is_active AS key_result_is_active
     FROM deployment_goal_links dgl
     LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
     LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
     LEFT JOIN board_objectives bo_via_kr ON bo_via_kr.id = bkr.objective_id
     LEFT JOIN boards b ON b.id = bo.board_id
     LEFT JOIN boards b_via_kr ON b_via_kr.id = bo_via_kr.board_id
     LEFT JOIN dev_teams dt ON dt.id = COALESCE(b.dev_team_id, b_via_kr.dev_team_id)
     LEFT JOIN sections s ON s.id = dt.section_id
     WHERE dgl.deployment_id = $1
     ORDER BY dgl.created_at DESC`,
    [deploymentId],
  )
  return result.rows
}

interface GoalFilterOption {
  id: number
  title: string
  dev_team_name: string | null
  period_label: string | null
}

/**
 * Get distinct objectives that are linked to deployments for the given app IDs.
 * Used to populate the goal filter dropdown on the deployment list page.
 * Returns team name and period label to disambiguate goals with the same title.
 */
export async function getLinkedObjectivesForApps(appIds: number[]): Promise<GoalFilterOption[]> {
  if (appIds.length === 0) return []
  const result = await pool.query<GoalFilterOption>(
    `SELECT DISTINCT COALESCE(bo.id, bo_via_kr.id) AS id,
            COALESCE(bo.title, bo_via_kr.title) AS title,
            dt.name AS dev_team_name,
            COALESCE(b.period_label, b_via_kr.period_label) AS period_label
     FROM deployment_goal_links dgl
     JOIN deployments d ON d.id = dgl.deployment_id
     LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
     LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
     LEFT JOIN board_objectives bo_via_kr ON bo_via_kr.id = bkr.objective_id
     LEFT JOIN boards b ON b.id = bo.board_id
     LEFT JOIN boards b_via_kr ON b_via_kr.id = bo_via_kr.board_id
     LEFT JOIN dev_teams dt ON dt.id = COALESCE(b.dev_team_id, b_via_kr.dev_team_id)
     WHERE d.monitored_app_id = ANY($1)
       AND dgl.is_active = true
       AND COALESCE(bo.id, bo_via_kr.id) IS NOT NULL
     ORDER BY dev_team_name, period_label, title`,
    [appIds],
  )
  return result.rows
}

export async function addDeploymentGoalLink(data: {
  deployment_id: number
  objective_id?: number
  key_result_id?: number
  external_url?: string
  external_url_title?: string
  comment?: string
  link_method: DeploymentGoalLink['link_method']
  linked_by?: string
}): Promise<DeploymentGoalLink | null> {
  if (!data.objective_id && !data.key_result_id) {
    throw new Error('Må angi objective_id eller key_result_id.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Reject linking to inactive objectives or key results (atomic with row locks)
    if (data.objective_id) {
      const obj = await client.query('SELECT is_active FROM board_objectives WHERE id = $1 FOR UPDATE', [
        data.objective_id,
      ])
      if (obj.rowCount === 0) {
        throw new Error('Målet finnes ikke.')
      }
      if (!obj.rows[0].is_active) {
        throw new Error('Kan ikke koble til et deaktivert mål.')
      }
    }
    if (data.key_result_id) {
      const kr = await client.query(
        `SELECT bkr.is_active AS kr_active, bo.is_active AS obj_active
         FROM board_key_results bkr
         JOIN board_objectives bo ON bo.id = bkr.objective_id
         WHERE bkr.id = $1
         FOR UPDATE OF bkr, bo`,
        [data.key_result_id],
      )
      if (kr.rowCount === 0) {
        throw new Error('Nøkkelresultatet finnes ikke.')
      }
      if (!kr.rows[0].kr_active) {
        throw new Error('Kan ikke koble til et deaktivert nøkkelresultat.')
      }
      if (!kr.rows[0].obj_active) {
        throw new Error('Kan ikke koble til et nøkkelresultat med deaktivert mål.')
      }
    }

    const insertSql = `INSERT INTO deployment_goal_links (deployment_id, objective_id, key_result_id, external_url, external_url_title, comment, link_method, linked_by)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
         WHERE NOT EXISTS (
           SELECT 1 FROM deployment_goal_links
           WHERE deployment_id = $1
             AND objective_id IS NOT DISTINCT FROM $2
             AND key_result_id IS NOT DISTINCT FROM $3
             AND is_active = true
         )
         RETURNING *`

    const result = await client.query(insertSql, [
      data.deployment_id,
      data.objective_id ?? null,
      data.key_result_id ?? null,
      data.external_url ?? null,
      data.external_url_title ?? null,
      data.comment ?? null,
      data.link_method,
      data.linked_by ?? null,
    ])
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query('COMMIT')
    return result.rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function removeDeploymentGoalLink(id: number, deploymentId: number): Promise<boolean> {
  // First check if the link exists and its current state
  const link = await pool.query(
    `SELECT dgl.id, dgl.is_active,
       COALESCE(bo.is_active, bo_via_kr.is_active, true) AS objective_is_active,
       COALESCE(bkr.is_active, true) AS kr_is_active
     FROM deployment_goal_links dgl
     LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
     LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
     LEFT JOIN board_objectives bo_via_kr ON bo_via_kr.id = bkr.objective_id
     WHERE dgl.id = $1 AND dgl.deployment_id = $2`,
    [id, deploymentId],
  )

  if (link.rowCount === 0) return false
  const row = link.rows[0]

  if (!row.is_active) return false // Already deactivated

  if (!row.objective_is_active || !row.kr_is_active) {
    throw new Error('Kan ikke fjerne kobling til et deaktivert mål eller nøkkelresultat.')
  }

  await pool.query('UPDATE deployment_goal_links SET is_active = false WHERE id = $1 AND deployment_id = $2', [
    id,
    deploymentId,
  ])
  return true
}

/**
 * Get IDs of deployments by a deployer that are Dependabot PRs without goal links.
 * Respects time period and app name filters.
 */
export async function getUnlinkedDependabotDeploymentIds(
  deployerUsername: string,
  startDate?: Date | null,
  endDate?: Date | null,
  appName?: string,
): Promise<number[]> {
  const { whereSql, params } = buildUnlinkedDependabotWhere(deployerUsername, startDate, endDate, appName)

  const result = await pool.query(
    `SELECT d.id FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     ${whereSql}
     ORDER BY d.created_at DESC`,
    params,
  )
  return result.rows.map((r: { id: number }) => r.id)
}

export async function hasUnlinkedDependabotDeployments(
  deployerUsername: string,
  startDate?: Date | null,
  endDate?: Date | null,
  appName?: string,
): Promise<boolean> {
  const { whereSql, params } = buildUnlinkedDependabotWhere(deployerUsername, startDate, endDate, appName)

  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       ${whereSql}
       LIMIT 1
     ) AS has_unlinked`,
    params,
  )
  return result.rows[0]?.has_unlinked === true
}

function buildUnlinkedDependabotWhere(
  deployerUsername: string,
  startDate?: Date | null,
  endDate?: Date | null,
  appName?: string,
): { whereSql: string; params: (string | Date)[] } {
  let whereSql = `WHERE ${userDeploymentMatchSql(1)}
    AND LOWER(d.github_pr_data->'creator'->>'username') = 'dependabot[bot]'
    AND ${AUDIT_START_YEAR_FILTER}
    AND NOT EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL))`
  const params: (string | Date)[] = [deployerUsername]
  let idx = 2

  if (startDate) {
    whereSql += ` AND d.created_at >= $${idx}`
    params.push(startDate)
    idx++
  }
  if (endDate) {
    whereSql += ` AND d.created_at <= $${idx}`
    params.push(endDate)
    idx++
  }
  if (appName) {
    whereSql += ` AND ma.app_name = $${idx}`
    params.push(appName)
    idx++
  }

  return { whereSql, params }
}

/**
 * Bulk-create goal links for multiple deployments.
 * Skips deployments that already have a link to the same objective/key result.
 */
export async function bulkAddDeploymentGoalLinks(
  deploymentIds: number[],
  goal: { objective_id?: number; key_result_id?: number },
  linkedBy?: string,
  options?: { external_url?: string; comment?: string },
): Promise<number> {
  if (deploymentIds.length === 0) return 0
  if (!goal.objective_id && !goal.key_result_id) {
    throw new Error('Må angi objective_id eller key_result_id.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Reject linking to inactive objectives or key results (inside transaction with row locks)
    if (goal.objective_id) {
      const obj = await client.query('SELECT is_active FROM board_objectives WHERE id = $1 FOR UPDATE', [
        goal.objective_id,
      ])
      if (obj.rowCount === 0) {
        throw new Error('Målet finnes ikke.')
      }
      if (!obj.rows[0].is_active) {
        throw new Error('Kan ikke koble til et deaktivert mål.')
      }
    }
    if (goal.key_result_id) {
      const kr = await client.query(
        `SELECT bkr.is_active AS kr_active, bo.is_active AS obj_active
         FROM board_key_results bkr
         JOIN board_objectives bo ON bo.id = bkr.objective_id
         WHERE bkr.id = $1
         FOR UPDATE OF bkr, bo`,
        [goal.key_result_id],
      )
      if (kr.rowCount === 0) {
        throw new Error('Nøkkelresultatet finnes ikke.')
      }
      if (!kr.rows[0].kr_active) {
        throw new Error('Kan ikke koble til et deaktivert nøkkelresultat.')
      }
      if (!kr.rows[0].obj_active) {
        throw new Error('Kan ikke koble til et nøkkelresultat med deaktivert mål.')
      }
    }

    let linked = 0
    for (const deploymentId of deploymentIds) {
      const result = await client.query(
        `INSERT INTO deployment_goal_links (deployment_id, objective_id, key_result_id, link_method, linked_by, external_url, comment)
         VALUES ($1, $2, $3, 'manual', $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          deploymentId,
          goal.objective_id ?? null,
          goal.key_result_id ?? null,
          linkedBy ?? null,
          options?.external_url ?? null,
          options?.comment ?? null,
        ],
      )
      if (result.rowCount && result.rowCount > 0) linked++
    }
    await client.query('COMMIT')
    return linked
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Get origin-of-change coverage stats for a dev team in a date range. */
export async function getOriginOfChangeCoverage(
  naisTeamSlugs: string[],
  startDate: Date,
  endDate: Date,
  directAppIds?: number[],
): Promise<{ total: number; linked: number; coverage: number }> {
  if (naisTeamSlugs.length === 0 && (!directAppIds || directAppIds.length === 0))
    return { total: 0, linked: 0, coverage: 0 }

  // If direct app IDs are provided, use them; otherwise fall back to nais team slugs
  if (directAppIds && directAppIds.length > 0) {
    const placeholders = directAppIds.map((_, i) => `$${i + 1}`).join(', ')
    const result = await pool.query(
      `SELECT
         COUNT(DISTINCT d.id) AS total,
         COUNT(DISTINCT dgl.deployment_id) AS linked
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id AND dgl.is_active = true
         AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
       WHERE d.monitored_app_id IN (${placeholders})
         AND d.created_at >= $${directAppIds.length + 1}
         AND d.created_at < $${directAppIds.length + 2}
         AND ${AUDIT_START_YEAR_FILTER}`,
      [...directAppIds, startDate, endDate],
    )
    const total = Number(result.rows[0]?.total ?? 0)
    const linked = Number(result.rows[0]?.linked ?? 0)
    return { total, linked, coverage: total > 0 ? linked / total : 0 }
  }

  const placeholders = naisTeamSlugs.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT d.id) AS total,
       COUNT(DISTINCT dgl.deployment_id) AS linked
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id AND dgl.is_active = true
       AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
     WHERE d.team_slug IN (${placeholders})
       AND d.created_at >= $${naisTeamSlugs.length + 1}
       AND d.created_at < $${naisTeamSlugs.length + 2}
       AND ${AUDIT_START_YEAR_FILTER}`,
    [...naisTeamSlugs, startDate, endDate],
  )

  const total = Number(result.rows[0]?.total ?? 0)
  const linked = Number(result.rows[0]?.linked ?? 0)
  return { total, linked, coverage: total > 0 ? linked / total : 0 }
}

interface DevTeamCoverageStats {
  total: number
  with_four_eyes: number
  four_eyes_percentage: number
  with_origin: number
  origin_percentage: number
}

/**
 * Aggregated stats for a dev team filtered to deployments performed by team members.
 * - `monitoredAppIds`: applications belonging to the team (direct + nais-team)
 * - `deployerUsernames`: GitHub usernames of team members
 * Empty member list ⇒ zero stats. Empty app list ⇒ zero stats.
 */
export async function getDevTeamCoverageStats(
  monitoredAppIds: number[],
  deployerUsernames: string[],
  startDate: Date,
  endDate: Date,
): Promise<DevTeamCoverageStats> {
  if (monitoredAppIds.length === 0 || deployerUsernames.length === 0) {
    return { total: 0, with_four_eyes: 0, four_eyes_percentage: 0, with_origin: 0, origin_percentage: 0 }
  }

  const result = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE d.four_eyes_status = ANY($4::text[])) AS with_four_eyes,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM deployment_goal_links dgl
         WHERE dgl.deployment_id = d.id AND dgl.is_active = true
           AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
       )) AS with_origin
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = ANY($1::int[])
       AND ${userDeploymentMatchAnySql(2)}
       AND d.created_at >= $3
       AND d.created_at < $5
       AND ${AUDIT_START_YEAR_FILTER}`,
    [monitoredAppIds, lowerUsernames(deployerUsernames), startDate, APPROVED_STATUSES, endDate],
  )

  const row = result.rows[0]
  const total = Number(row?.total ?? 0)
  const withFourEyes = Number(row?.with_four_eyes ?? 0)
  const withOrigin = Number(row?.with_origin ?? 0)

  return {
    total,
    with_four_eyes: withFourEyes,
    four_eyes_percentage: total > 0 ? Math.round((withFourEyes / total) * 100) : 0,
    with_origin: withOrigin,
    origin_percentage: total > 0 ? Math.round((withOrigin / total) * 100) : 0,
  }
}
