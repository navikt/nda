import { pool } from './connection.server'

interface ApplicationGroup {
  id: number
  name: string
  created_at: Date
}

type SiblingApp = { id: number; team_slug: string; environment_name: string; app_name: string }

export async function getGroupByAppId(monitoredAppId: number): Promise<ApplicationGroup | null> {
  const { rows } = await pool.query<ApplicationGroup>(
    `SELECT ag.*
     FROM application_groups ag
     JOIN monitored_applications ma ON ma.application_group_id = ag.id
     WHERE ma.id = $1 AND ag.deleted_at IS NULL`,
    [monitoredAppId],
  )
  return rows[0] ?? null
}

interface ApplicationGroupWithApps extends ApplicationGroup {
  apps: SiblingApp[]
}

export async function getGroupWithApps(groupId: number): Promise<ApplicationGroupWithApps | null> {
  const { rows: groupRows } = await pool.query<ApplicationGroup>(
    'SELECT * FROM application_groups WHERE id = $1 AND deleted_at IS NULL',
    [groupId],
  )
  if (groupRows.length === 0) return null

  const { rows: appRows } = await pool.query<SiblingApp>(
    `SELECT id, team_slug, environment_name, app_name
     FROM monitored_applications
     WHERE application_group_id = $1
     ORDER BY environment_name, team_slug`,
    [groupId],
  )

  return { ...groupRows[0], apps: appRows }
}

export async function getSiblingApps(monitoredAppId: number): Promise<SiblingApp[]> {
  const { rows } = await pool.query<SiblingApp>(
    `SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name
     FROM monitored_applications ma
     JOIN application_groups ag ON ag.id = ma.application_group_id AND ag.deleted_at IS NULL
     WHERE ma.application_group_id = (
       SELECT application_group_id FROM monitored_applications WHERE id = $1
     )
     AND ma.application_group_id IS NOT NULL
     AND ma.id != $1
     ORDER BY ma.environment_name, ma.team_slug`,
    [monitoredAppId],
  )
  return rows
}

interface GroupContext {
  group: ApplicationGroup | null
  siblings: SiblingApp[]
}

interface GroupContextRow {
  group_id: number | null
  group_name: string | null
  group_created_at: Date | null
  sibling_id: number | null
  team_slug: string | null
  environment_name: string | null
  app_name: string | null
}

export async function getGroupContext(monitoredAppId: number): Promise<GroupContext> {
  const { rows } = await pool.query<GroupContextRow>(
    `SELECT
       ag.id AS group_id, ag.name AS group_name, ag.created_at AS group_created_at,
       sibling.id AS sibling_id, sibling.team_slug, sibling.environment_name, sibling.app_name
     FROM monitored_applications ma
     LEFT JOIN application_groups ag ON ag.id = ma.application_group_id AND ag.deleted_at IS NULL
     LEFT JOIN monitored_applications sibling
       ON sibling.application_group_id = ag.id AND sibling.id != $1
     WHERE ma.id = $1
     ORDER BY sibling.environment_name, sibling.team_slug`,
    [monitoredAppId],
  )

  if (rows.length === 0 || rows[0].group_id === null) {
    return { group: null, siblings: [] }
  }

  const group: ApplicationGroup = {
    id: rows[0].group_id,
    name: rows[0].group_name as string,
    created_at: rows[0].group_created_at as Date,
  }

  const siblings: SiblingApp[] = rows
    .filter(
      (
        r,
      ): r is GroupContextRow & { sibling_id: number; team_slug: string; environment_name: string; app_name: string } =>
        r.sibling_id !== null,
    )
    .map((r) => ({
      id: r.sibling_id,
      team_slug: r.team_slug,
      environment_name: r.environment_name,
      app_name: r.app_name,
    }))

  return { group, siblings }
}

export async function getAppIdsByGroupIds(groupIds: number[]): Promise<Map<number, number[]>> {
  if (groupIds.length === 0) return new Map()

  const result = await pool.query<{ application_group_id: number; id: number }>(
    `SELECT ma.application_group_id, ma.id
     FROM monitored_applications ma
     JOIN application_groups ag ON ag.id = ma.application_group_id AND ag.deleted_at IS NULL
     WHERE ma.application_group_id = ANY($1)`,
    [groupIds],
  )

  const map = new Map<number, number[]>()
  for (const row of result.rows) {
    const ids = map.get(row.application_group_id) ?? []
    ids.push(row.id)
    map.set(row.application_group_id, ids)
  }
  return map
}
