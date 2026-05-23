import { pool } from './connection.server'

/**
 * Soft-deleted row management for the admin restore page.
 *
 * Covers the six tables that use the deleted_at/deleted_by pattern:
 *   - user_mappings
 *   - deployment_comments
 *   - dev_team_applications
 *   - section_teams
 *   - dev_team_nais_teams
 *   - external_references
 *
 * Boards/objectives/key_results/deployment_goal_links use the older `is_active`
 * pattern without deleted_by/deleted_at metadata and are intentionally excluded
 * from this view (no audit info available for who/when).
 */

interface SoftDeletedUserMapping {
  github_username: string
  display_github_username: string | null
  display_name: string | null
  nav_ident: string | null
  deleted_at: Date
  deleted_by: string | null
}

interface SoftDeletedDeploymentComment {
  id: number
  deployment_id: number
  app_name: string
  team_slug: string
  environment_name: string
  comment_type: string
  body_excerpt: string
  deleted_at: Date
  deleted_by: string | null
}

interface SoftDeletedDevTeamApplication {
  dev_team_id: number
  dev_team_name: string
  monitored_app_id: number
  app_name: string
  team_slug: string
  environment_name: string
  deleted_at: Date
  deleted_by: string | null
}

interface SoftDeletedSectionTeam {
  section_id: number
  section_name: string
  team_slug: string
  deleted_at: Date
  deleted_by: string | null
}

interface SoftDeletedDevTeamNaisTeam {
  dev_team_id: number
  dev_team_name: string
  nais_team_slug: string
  deleted_at: Date
  deleted_by: string | null
}

interface SoftDeletedExternalReference {
  id: number
  ref_type: string
  url: string
  title: string | null
  objective_id: number | null
  key_result_id: number | null
  parent_label: string
  parent_active: boolean
  deleted_at: Date
  deleted_by: string | null
}

interface SoftDeletedSummary {
  userMappings: SoftDeletedUserMapping[]
  deploymentComments: SoftDeletedDeploymentComment[]
  devTeamApplications: SoftDeletedDevTeamApplication[]
  sectionTeams: SoftDeletedSectionTeam[]
  devTeamNaisTeams: SoftDeletedDevTeamNaisTeam[]
  externalReferences: SoftDeletedExternalReference[]
}

export async function getAllSoftDeleted(): Promise<SoftDeletedSummary> {
  const [userMappings, deploymentComments, devTeamApplications, sectionTeams, devTeamNaisTeams, externalReferences] =
    await Promise.all([
      pool.query<SoftDeletedUserMapping>(
        `SELECT github_username, display_github_username, display_name, nav_ident, deleted_at, deleted_by
         FROM user_mappings
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC`,
      ),
      pool.query<SoftDeletedDeploymentComment>(
        `SELECT dc.id,
                dc.deployment_id,
                ma.app_name,
                ma.team_slug,
                ma.environment_name,
                dc.comment_type,
                LEFT(dc.comment_text, 200) AS body_excerpt,
                dc.deleted_at,
                dc.deleted_by
         FROM deployment_comments dc
         JOIN deployments d ON d.id = dc.deployment_id
         JOIN monitored_applications ma ON ma.id = d.monitored_app_id
         WHERE dc.deleted_at IS NOT NULL
           AND dc.comment_type NOT IN ('manual_approval', 'legacy_info')
         ORDER BY dc.deleted_at DESC`,
      ),
      pool.query<SoftDeletedDevTeamApplication>(
        `SELECT dta.dev_team_id,
                dt.name AS dev_team_name,
                dta.monitored_app_id,
                ma.app_name,
                ma.team_slug,
                ma.environment_name,
                dta.deleted_at,
                dta.deleted_by
         FROM dev_team_applications dta
         JOIN dev_teams dt ON dt.id = dta.dev_team_id
         JOIN monitored_applications ma ON ma.id = dta.monitored_app_id
         WHERE dta.deleted_at IS NOT NULL
         ORDER BY dta.deleted_at DESC`,
      ),
      pool.query<SoftDeletedSectionTeam>(
        `SELECT st.section_id,
                s.name AS section_name,
                st.team_slug,
                st.deleted_at,
                st.deleted_by
         FROM section_teams st
         JOIN sections s ON s.id = st.section_id
         WHERE st.deleted_at IS NOT NULL
         ORDER BY st.deleted_at DESC`,
      ),
      pool.query<SoftDeletedDevTeamNaisTeam>(
        `SELECT dtn.dev_team_id,
                dt.name AS dev_team_name,
                dtn.nais_team_slug,
                dtn.deleted_at,
                dtn.deleted_by
         FROM dev_team_nais_teams dtn
         JOIN dev_teams dt ON dt.id = dtn.dev_team_id
         WHERE dtn.deleted_at IS NOT NULL
         ORDER BY dtn.deleted_at DESC`,
      ),
      pool.query<SoftDeletedExternalReference>(
        `SELECT er.id,
                er.ref_type,
                er.url,
                er.title,
                er.objective_id,
                er.key_result_id,
                COALESCE(
                  CASE
                    WHEN er.objective_id IS NOT NULL THEN 'Mål: ' || bo_obj.title
                    WHEN er.key_result_id IS NOT NULL THEN 'KR: ' || bkr.title
                  END,
                  'Ukjent'
                ) AS parent_label,
                CASE
                  WHEN er.objective_id IS NOT NULL THEN bo_obj.is_active
                  WHEN er.key_result_id IS NOT NULL THEN (bkr.is_active AND bo_kr.is_active)
                  ELSE false
                END AS parent_active,
                er.deleted_at,
                er.deleted_by
         FROM external_references er
         LEFT JOIN board_objectives bo_obj ON bo_obj.id = er.objective_id
         LEFT JOIN board_key_results bkr ON bkr.id = er.key_result_id
         LEFT JOIN board_objectives bo_kr ON bo_kr.id = bkr.objective_id
         WHERE er.deleted_at IS NOT NULL
         ORDER BY er.deleted_at DESC`,
      ),
    ])

  return {
    userMappings: userMappings.rows,
    deploymentComments: deploymentComments.rows,
    devTeamApplications: devTeamApplications.rows,
    sectionTeams: sectionTeams.rows,
    devTeamNaisTeams: devTeamNaisTeams.rows,
    externalReferences: externalReferences.rows,
  }
}

/**
 * Restore (undelete) a soft-deleted user mapping.
 *
 * No-op if the row is missing or already active.
 */
export async function restoreUserMapping(githubUsername: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE user_mappings
     SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
     WHERE github_username = LOWER($1) AND deleted_at IS NOT NULL
     RETURNING github_username`,
    [githubUsername.trim()],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Restore a soft-deleted deployment comment.
 *
 * Refuses to restore `manual_approval` and `legacy_info` comment types: those
 * are coupled to deployment state (four_eyes_status / legacy metadata) which
 * is updated atomically by the dedicated create/delete flows. Restoring just
 * the comment row would leave the deployment in an inconsistent state.
 * Such comments are also filtered out of the listing in `getAllSoftDeleted`.
 */
export async function restoreDeploymentComment(id: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE deployment_comments
     SET deleted_at = NULL, deleted_by = NULL
     WHERE id = $1
       AND deleted_at IS NOT NULL
       AND comment_type NOT IN ('manual_approval', 'legacy_info')
     RETURNING id`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function restoreDevTeamApplication(devTeamId: number, monitoredAppId: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE dev_team_applications
     SET deleted_at = NULL, deleted_by = NULL
     WHERE dev_team_id = $1 AND monitored_app_id = $2 AND deleted_at IS NOT NULL
     RETURNING dev_team_id`,
    [devTeamId, monitoredAppId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function restoreSectionTeam(sectionId: number, teamSlug: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE section_teams
     SET deleted_at = NULL, deleted_by = NULL
     WHERE section_id = $1 AND team_slug = $2 AND deleted_at IS NOT NULL
     RETURNING section_id`,
    [sectionId, teamSlug],
  )
  return (result.rowCount ?? 0) > 0
}

export async function restoreDevTeamNaisTeam(devTeamId: number, naisTeamSlug: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE dev_team_nais_teams
     SET deleted_at = NULL, deleted_by = NULL
     WHERE dev_team_id = $1 AND nais_team_slug = $2 AND deleted_at IS NOT NULL
     RETURNING dev_team_id`,
    [devTeamId, naisTeamSlug],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Restore an external reference. Refuses to restore if the parent objective or
 * key result is deactivated, mirroring the same business rule as
 * deleteExternalReference: deactivated goals must not gain new active links.
 *
 * Runs in a transaction with `SELECT ... FOR UPDATE` on the parent rows so a
 * concurrent deactivation cannot interleave between the parent-active check
 * and the restore (mirroring `addExternalReference`'s locking pattern).
 */
export async function restoreExternalReference(id: number): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Look up the reference's parent ids; lock the row to serialize against a
    // concurrent restore of the same reference.
    const refRow = await client.query<{
      objective_id: number | null
      key_result_id: number | null
      deleted_at: Date | null
    }>('SELECT objective_id, key_result_id, deleted_at FROM external_references WHERE id = $1 FOR UPDATE', [id])
    if (refRow.rows.length === 0) {
      await client.query('ROLLBACK')
      return false
    }
    const ref = refRow.rows[0]
    if (ref.deleted_at === null) {
      await client.query('ROLLBACK')
      return false
    }

    // Lock + validate parent activity. Held until COMMIT so a concurrent
    // deactivation cannot win between the check and the UPDATE.
    if (ref.objective_id !== null) {
      const obj = await client.query<{ is_active: boolean }>(
        'SELECT is_active FROM board_objectives WHERE id = $1 FOR UPDATE',
        [ref.objective_id],
      )
      if (!obj.rows[0]?.is_active) {
        await client.query('ROLLBACK')
        throw new Error('Kan ikke gjenopprette ekstern lenke fordi tilhørende mål eller nøkkelresultat er deaktivert.')
      }
    }
    if (ref.key_result_id !== null) {
      const kr = await client.query<{ kr_active: boolean; obj_active: boolean }>(
        `SELECT bkr.is_active AS kr_active, bo.is_active AS obj_active
         FROM board_key_results bkr
         JOIN board_objectives bo ON bo.id = bkr.objective_id
         WHERE bkr.id = $1
         FOR UPDATE OF bkr, bo`,
        [ref.key_result_id],
      )
      if (!kr.rows[0]?.kr_active || !kr.rows[0]?.obj_active) {
        await client.query('ROLLBACK')
        throw new Error('Kan ikke gjenopprette ekstern lenke fordi tilhørende mål eller nøkkelresultat er deaktivert.')
      }
    }

    const updated = await client.query(
      `UPDATE external_references
       SET deleted_at = NULL, deleted_by = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id`,
      [id],
    )
    await client.query('COMMIT')
    return (updated.rowCount ?? 0) > 0
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore — original error is the interesting one
    }
    throw err
  } finally {
    client.release()
  }
}
