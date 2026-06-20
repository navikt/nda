import { pool } from './connection.server'

const DEV_TEAM_APPLICATIONS_LOCK_NAMESPACE = 1772400000

const DEV_TEAM_NAIS_TEAMS_LOCK_NAMESPACE = 1772500002

export interface DevTeam {
  id: number
  section_id: number
  slug: string
  name: string
  is_active: boolean
  created_at: Date
}

export interface DevTeamWithNaisTeams extends DevTeam {
  nais_team_slugs: string[]
  section_slug?: string
}

export interface DevTeamApplication {
  monitored_app_id: number
  team_slug: string
  environment_name: string
  app_name: string
}

export async function getAllDevTeams(): Promise<DevTeamWithNaisTeams[]> {
  const result = await pool.query(
    `SELECT dt.*, s.slug as section_slug,
       COALESCE(array_agg(dn.nais_team_slug ORDER BY dn.nais_team_slug) FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs
     FROM dev_teams dt
     JOIN sections s ON s.id = dt.section_id
     LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id AND dn.deleted_at IS NULL
     WHERE dt.is_active = true
     GROUP BY dt.id, s.slug
     ORDER BY dt.name`,
  )
  return result.rows
}

export async function getDevTeamsBySection(sectionId: number): Promise<DevTeamWithNaisTeams[]> {
  const result = await pool.query(
    `SELECT dt.*, s.slug as section_slug,
       COALESCE(array_agg(dn.nais_team_slug ORDER BY dn.nais_team_slug) FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs
     FROM dev_teams dt
     LEFT JOIN sections s ON s.id = dt.section_id
     LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id AND dn.deleted_at IS NULL
     WHERE dt.section_id = $1 AND dt.is_active = true
     GROUP BY dt.id, s.slug
     ORDER BY dt.name`,
    [sectionId],
  )
  return result.rows
}

export async function getDevTeamBySlug(slug: string): Promise<DevTeamWithNaisTeams | null> {
  const result = await pool.query(
    `SELECT dt.*, s.slug as section_slug,
       COALESCE(array_agg(dn.nais_team_slug ORDER BY dn.nais_team_slug) FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs
     FROM dev_teams dt
     JOIN sections s ON s.id = dt.section_id
     LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id AND dn.deleted_at IS NULL
     WHERE dt.slug = $1
     GROUP BY dt.id, s.slug`,
    [slug],
  )
  return result.rows[0] ?? null
}

async function getDevTeamById(id: number): Promise<DevTeamWithNaisTeams | null> {
  const result = await pool.query(
    `SELECT dt.*,
       COALESCE(array_agg(dn.nais_team_slug ORDER BY dn.nais_team_slug) FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs
     FROM dev_teams dt
     LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id AND dn.deleted_at IS NULL
     WHERE dt.id = $1
     GROUP BY dt.id`,
    [id],
  )
  return result.rows[0] ?? null
}

async function _getDevTeamForNaisTeam(naisTeamSlug: string): Promise<DevTeam | null> {
  const result = await pool.query(
    `SELECT dt.* FROM dev_teams dt
     JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id
     WHERE dn.nais_team_slug = $1 AND dn.deleted_at IS NULL AND dt.is_active = true`,
    [naisTeamSlug],
  )
  return result.rows[0] ?? null
}

export async function getDevTeamsForApp(
  monitoredAppId: number,
  teamSlug: string,
): Promise<(DevTeam & { section_slug: string })[]> {
  return getDevTeamsForApps([{ monitoredAppId, teamSlug }])
}

export async function getDevTeamsForApps(
  apps: Array<{ monitoredAppId: number; teamSlug: string }>,
): Promise<(DevTeam & { section_slug: string })[]> {
  if (apps.length === 0) return []
  const appIds = apps.map((a) => a.monitoredAppId)
  const teamSlugs = [...new Set(apps.map((a) => a.teamSlug))]
  const result = await pool.query(
    `SELECT DISTINCT dt.*, s.slug AS section_slug FROM dev_teams dt
     JOIN sections s ON s.id = dt.section_id
     LEFT JOIN dev_team_applications dta
       ON dta.dev_team_id = dt.id AND dta.monitored_app_id = ANY($1) AND dta.deleted_at IS NULL
     LEFT JOIN dev_team_nais_teams dnt ON dnt.dev_team_id = dt.id AND dnt.nais_team_slug = ANY($2) AND dnt.deleted_at IS NULL
     WHERE dt.is_active = true AND (dta.monitored_app_id IS NOT NULL OR dnt.nais_team_slug IS NOT NULL)
     ORDER BY dt.name`,
    [appIds, teamSlugs],
  )
  return result.rows
}

export async function createDevTeam(sectionId: number, slug: string, name: string): Promise<DevTeam> {
  const result = await pool.query('INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3) RETURNING *', [
    sectionId,
    slug,
    name,
  ])
  return result.rows[0]
}

export async function updateDevTeam(id: number, data: { name?: string; is_active?: boolean }): Promise<DevTeam | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.name !== undefined) {
    sets.push(`name = $${idx++}`)
    values.push(data.name)
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`)
    values.push(data.is_active)
  }

  if (sets.length === 0) return getDevTeamById(id)

  values.push(id)
  const result = await pool.query(`UPDATE dev_teams SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values)
  return result.rows[0] ?? null
}

export async function setDevTeamNaisTeams(
  devTeamId: number,
  naisTeamSlugs: string[],
  deletedBy: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [DEV_TEAM_NAIS_TEAMS_LOCK_NAMESPACE, devTeamId])

    await client.query(
      `UPDATE dev_team_nais_teams
       SET deleted_at = NOW(), deleted_by = $2
       WHERE dev_team_id = $1
         AND deleted_at IS NULL
         AND NOT (nais_team_slug = ANY($3::text[]))`,
      [devTeamId, deletedBy, naisTeamSlugs],
    )

    for (const slug of naisTeamSlugs) {
      await client.query(
        `INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug)
         VALUES ($1, $2)
         ON CONFLICT (dev_team_id, nais_team_slug)
         DO UPDATE SET deleted_at = NULL, deleted_by = NULL
         WHERE dev_team_nais_teams.deleted_at IS NOT NULL`,
        [devTeamId, slug],
      )
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function getDevTeamApplications(devTeamId: number): Promise<DevTeamApplication[]> {
  const result = await pool.query(
    `SELECT ma.id AS monitored_app_id, ma.team_slug, ma.environment_name, ma.app_name
     FROM dev_team_applications dta
     JOIN monitored_applications ma ON ma.id = dta.monitored_app_id
     WHERE dta.dev_team_id = $1 AND dta.deleted_at IS NULL
     ORDER BY ma.team_slug, ma.environment_name, ma.app_name`,
    [devTeamId],
  )
  return result.rows
}

export async function setDevTeamApplications(
  devTeamId: number,
  monitoredAppIds: number[],
  deletedBy: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [DEV_TEAM_APPLICATIONS_LOCK_NAMESPACE, devTeamId])

    await client.query(
      `UPDATE dev_team_applications
       SET deleted_at = NOW(), deleted_by = $2
       WHERE dev_team_id = $1
         AND deleted_at IS NULL
         AND NOT (monitored_app_id = ANY($3::int[]))`,
      [devTeamId, deletedBy, monitoredAppIds],
    )

    for (const appId of monitoredAppIds) {
      await client.query(
        `INSERT INTO dev_team_applications (dev_team_id, monitored_app_id)
         VALUES ($1, $2)
         ON CONFLICT (dev_team_id, monitored_app_id)
         DO UPDATE SET deleted_at = NULL, deleted_by = NULL
         WHERE dev_team_applications.deleted_at IS NOT NULL`,
        [devTeamId, appId],
      )
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function addAppToDevTeam(devTeamId: number, monitoredAppId: number): Promise<void> {
  await pool.query(
    `INSERT INTO dev_team_applications (dev_team_id, monitored_app_id)
     VALUES ($1, $2)
     ON CONFLICT (dev_team_id, monitored_app_id)
     DO UPDATE SET deleted_at = NULL, deleted_by = NULL
     WHERE dev_team_applications.deleted_at IS NOT NULL`,
    [devTeamId, monitoredAppId],
  )
}

export async function addNaisTeamToDevTeam(devTeamId: number, naisTeamSlug: string): Promise<void> {
  await pool.query(
    `INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug)
     VALUES ($1, $2)
     ON CONFLICT (dev_team_id, nais_team_slug)
     DO UPDATE SET deleted_at = NULL, deleted_by = NULL
     WHERE dev_team_nais_teams.deleted_at IS NOT NULL`,
    [devTeamId, naisTeamSlug],
  )
}

export async function removeNaisTeamFromDevTeam(
  devTeamId: number,
  naisTeamSlug: string,
  deletedBy: string,
): Promise<void> {
  await pool.query(
    `UPDATE dev_team_nais_teams
     SET deleted_at = NOW(), deleted_by = $3
     WHERE dev_team_id = $1 AND nais_team_slug = $2 AND deleted_at IS NULL`,
    [devTeamId, naisTeamSlug, deletedBy],
  )
}

export async function removeAppFromDevTeam(
  devTeamId: number,
  monitoredAppId: number,
  deletedBy: string,
): Promise<void> {
  await pool.query(
    `UPDATE dev_team_applications
     SET deleted_at = NOW(), deleted_by = $3
     WHERE dev_team_id = $1 AND monitored_app_id = $2 AND deleted_at IS NULL`,
    [devTeamId, monitoredAppId, deletedBy],
  )
}

export async function getAvailableAppsForDevTeam(
  devTeamId: number,
): Promise<{ id: number; team_slug: string; environment_name: string; app_name: string; is_linked: boolean }[]> {
  const result = await pool.query(
    `SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name,
            (dta.dev_team_id IS NOT NULL) AS is_linked
     FROM monitored_applications ma
     LEFT JOIN dev_team_applications dta
       ON dta.monitored_app_id = ma.id AND dta.dev_team_id = $1 AND dta.deleted_at IS NULL
     WHERE ma.is_active = true
     ORDER BY ma.team_slug, ma.environment_name, ma.app_name`,
    [devTeamId],
  )
  return result.rows
}

export async function getGroupAppIdsForDevTeams(devTeamIds: number[]): Promise<number[]> {
  if (devTeamIds.length === 0) return []
  const result = await pool.query<{ id: number }>(
    `SELECT DISTINCT ma.id
     FROM dev_team_application_groups dtag
     JOIN application_groups ag ON ag.id = dtag.application_group_id AND ag.deleted_at IS NULL
     JOIN monitored_applications ma ON ma.application_group_id = ag.id AND ma.is_active = true
     WHERE dtag.dev_team_id = ANY($1::int[]) AND dtag.deleted_at IS NULL`,
    [devTeamIds],
  )
  return result.rows.map((r) => r.id)
}

export async function getExclusivelyOwnedAppIds(devTeamId: number, appIds: number[]): Promise<Set<number>> {
  if (appIds.length === 0) return new Set()

  const result = await pool.query<{ app_id: number }>(
    `WITH app_owners AS (
       -- Path 1: direct dev_team_applications links
       SELECT dta.monitored_app_id AS app_id, dta.dev_team_id
       FROM dev_team_applications dta
       JOIN monitored_applications ma ON ma.id = dta.monitored_app_id AND ma.is_active = true
       JOIN dev_teams dt ON dt.id = dta.dev_team_id AND dt.is_active = true
       WHERE dta.monitored_app_id = ANY($1::int[]) AND dta.deleted_at IS NULL

       UNION

       -- Path 2: via nais team slug
       SELECT ma.id AS app_id, dnt.dev_team_id
       FROM monitored_applications ma
       JOIN dev_team_nais_teams dnt ON dnt.nais_team_slug = ma.team_slug AND dnt.deleted_at IS NULL
       JOIN dev_teams dt ON dt.id = dnt.dev_team_id AND dt.is_active = true
       WHERE ma.id = ANY($1::int[]) AND ma.is_active = true

       UNION

       -- Path 3: via application groups
       SELECT ma.id AS app_id, dtag.dev_team_id
       FROM dev_team_application_groups dtag
       JOIN application_groups ag ON ag.id = dtag.application_group_id AND ag.deleted_at IS NULL
       JOIN monitored_applications ma ON ma.application_group_id = ag.id AND ma.is_active = true
       JOIN dev_teams dt ON dt.id = dtag.dev_team_id AND dt.is_active = true
       WHERE ma.id = ANY($1::int[]) AND dtag.deleted_at IS NULL
     )
     SELECT app_id
     FROM app_owners
     GROUP BY app_id
     HAVING COUNT(DISTINCT dev_team_id) = 1
        AND MIN(dev_team_id) = $2`,
    [appIds, devTeamId],
  )

  return new Set(result.rows.map((r) => r.app_id))
}
