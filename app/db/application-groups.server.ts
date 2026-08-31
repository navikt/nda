import { getActiveRepoKeysForApps } from './application-repositories.server'
import { pool } from './connection.server'

interface ApplicationGroup {
  id: number
  name: string
  created_at: Date
}

interface ApplicationGroupWithApps extends ApplicationGroup {
  apps: Array<{
    id: number
    team_slug: string
    environment_name: string
    app_name: string
  }>
}

interface ApplicationGroupWithTeamApps extends ApplicationGroup {
  apps: Array<{
    id: number
    team_slug: string
    environment_name: string
    app_name: string
    is_team_app: boolean
  }>
}

export interface UngroupedTeamApp {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
}

interface ApplicationGroupSummary extends ApplicationGroup {
  app_count: number
}

function pickLargestRepoSharingSubset<T extends { id: number }>(
  apps: T[],
  repoKeysByApp: Map<number, Set<string>>,
): { matched: T[]; skipped: number } {
  if (apps.length < 2) return { matched: apps, skipped: 0 }

  const singleRepoKeyByApp = new Map<number, string>()
  for (const app of apps) {
    const keys = repoKeysByApp.get(app.id)
    if (keys?.size === 1) singleRepoKeyByApp.set(app.id, [...keys][0])
  }

  const repoKeyCounts = new Map<string, number>()
  for (const key of singleRepoKeyByApp.values()) {
    repoKeyCounts.set(key, (repoKeyCounts.get(key) ?? 0) + 1)
  }

  const bestRepoKey = [...repoKeyCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
  if (!bestRepoKey) return { matched: [], skipped: apps.length }

  const matched = apps.filter((app) => singleRepoKeyByApp.get(app.id) === bestRepoKey)
  return { matched, skipped: apps.length - matched.length }
}

export async function selectAppsSharingRepository<T extends { id: number }>(
  apps: T[],
): Promise<{ matched: T[]; skipped: number }> {
  if (apps.length < 2) return { matched: apps, skipped: 0 }

  const repoKeysByApp = await getActiveRepoKeysForApps(apps.map((a) => a.id))
  return pickLargestRepoSharingSubset(apps, repoKeysByApp)
}

export async function computeGroupingSuggestions<T extends { id: number; app_name: string }>(
  apps: T[],
): Promise<Array<{ name: string; count: number }>> {
  const repoKeysByApp = await getActiveRepoKeysForApps(apps.map((a) => a.id))

  const appsByName = new Map<string, T[]>()
  for (const app of apps) {
    const existing = appsByName.get(app.app_name)
    if (existing) {
      existing.push(app)
    } else {
      appsByName.set(app.app_name, [app])
    }
  }

  return [...appsByName.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([name, group]) => ({ name, count: pickLargestRepoSharingSubset(group, repoKeysByApp).matched.length }))
}

export async function createApplicationGroup(name: string): Promise<ApplicationGroup> {
  const { rows } = await pool.query<ApplicationGroup>('INSERT INTO application_groups (name) VALUES ($1) RETURNING *', [
    name,
  ])
  return rows[0]
}

function invalidActiveRepoCountClause(appIdParam: string): string {
  return `(SELECT COUNT(*) FROM application_repositories ar WHERE ar.monitored_app_id = ${appIdParam} AND ar.status = 'active') != 1`
}

function repoMismatchExistsClause(groupIdParam: string, appIdParam: string): string {
  return `EXISTS (
    SELECT 1 FROM monitored_applications existing
    WHERE existing.application_group_id = ${groupIdParam}
      AND existing.id != ${appIdParam}
      AND (
        ${invalidActiveRepoCountClause('existing.id')}
        OR NOT EXISTS (
          SELECT 1 FROM application_repositories ar1
          JOIN application_repositories ar2
            ON ar1.github_owner = ar2.github_owner
           AND ar1.github_repo_name = ar2.github_repo_name
          WHERE ar1.monitored_app_id = ${appIdParam} AND ar1.status = 'active'
            AND ar2.monitored_app_id = existing.id AND ar2.status = 'active'
        )
      )
  )`
}

export async function addAppToGroup(groupId: number, monitoredAppId: number): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rowCount: groupLocked } = await client.query(
      'SELECT 1 FROM application_groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [groupId],
    )
    if (!groupLocked) {
      await client.query('ROLLBACK')
      return false
    }
    const result = await client.query(
      `UPDATE monitored_applications
       SET application_group_id = $1
       WHERE id = $2
         AND application_group_id IS NULL
         AND NOT ${invalidActiveRepoCountClause('$2')}
         AND NOT ${repoMismatchExistsClause('$1', '$2')}`,
      [groupId, monitoredAppId],
    )
    await client.query('COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function addTeamAppToGroupConditional(
  groupId: number,
  appId: number,
  devTeamId: number,
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rowCount: groupLocked } = await client.query(
      'SELECT 1 FROM application_groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [groupId],
    )
    if (!groupLocked) {
      await client.query('ROLLBACK')
      return false
    }
    const result = await client.query(
      `UPDATE monitored_applications
       SET application_group_id = $1
       WHERE id = $2
         AND application_group_id IS NULL
         AND is_active = true
         AND EXISTS (
           SELECT 1 FROM dev_team_applications
           WHERE dev_team_id = $3 AND monitored_app_id = $2 AND deleted_at IS NULL
         )
         AND NOT ${invalidActiveRepoCountClause('$2')}
         AND NOT ${repoMismatchExistsClause('$1', '$2')}`,
      [groupId, appId, devTeamId],
    )
    await client.query('COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function removeAppFromGroup(monitoredAppId: number): Promise<void> {
  await pool.query('UPDATE monitored_applications SET application_group_id = NULL WHERE id = $1', [monitoredAppId])
}

export async function getGroupWithApps(groupId: number): Promise<ApplicationGroupWithApps | null> {
  const { rows: groupRows } = await pool.query<ApplicationGroup>(
    'SELECT * FROM application_groups WHERE id = $1 AND deleted_at IS NULL',
    [groupId],
  )
  if (groupRows.length === 0) return null

  const { rows: appRows } = await pool.query<{
    id: number
    team_slug: string
    environment_name: string
    app_name: string
  }>(
    `SELECT id, team_slug, environment_name, app_name
     FROM monitored_applications
     WHERE application_group_id = $1
     ORDER BY environment_name, team_slug`,
    [groupId],
  )

  return { ...groupRows[0], apps: appRows }
}

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

type SiblingApp = { id: number; team_slug: string; environment_name: string; app_name: string }

export async function getSiblingApps(monitoredAppId: number): Promise<SiblingApp[]> {
  const { rows } = await pool.query<SiblingApp>(
    `SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name
     FROM monitored_applications ma
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

export async function deleteGroup(groupId: number, deletedBy: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE application_groups
       SET deleted_at = NOW(), deleted_by = $2
       WHERE id = $1 AND deleted_at IS NULL`,
      [groupId, deletedBy],
    )
    await client.query(
      'UPDATE monitored_applications SET application_group_id = NULL WHERE application_group_id = $1',
      [groupId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function getAllGroups(): Promise<ApplicationGroupSummary[]> {
  const { rows } = await pool.query<ApplicationGroupSummary>(
    `SELECT ag.*, COUNT(ma.id)::int AS app_count
     FROM application_groups ag
     LEFT JOIN monitored_applications ma ON ma.application_group_id = ag.id
     WHERE ag.deleted_at IS NULL
     GROUP BY ag.id
     ORDER BY ag.name`,
  )
  return rows
}

export async function getGroupsForDevTeam(devTeamId: number): Promise<ApplicationGroupWithTeamApps[]> {
  const { rows } = await pool.query<{
    id: number
    name: string
    created_at: Date
    apps: Array<{
      id: number
      team_slug: string
      environment_name: string
      app_name: string
      is_team_app: boolean
    }>
  }>(
    `SELECT ag.id, ag.name, ag.created_at,
       json_agg(json_build_object(
         'id', ma.id,
         'team_slug', ma.team_slug,
         'environment_name', ma.environment_name,
         'app_name', ma.app_name,
         'is_team_app', COALESCE((dta.dev_team_id = $1), false)
       ) ORDER BY ma.environment_name, ma.team_slug, ma.app_name) AS apps
     FROM application_groups ag
     JOIN monitored_applications ma ON ma.application_group_id = ag.id
     LEFT JOIN dev_team_applications dta
       ON dta.monitored_app_id = ma.id
       AND dta.dev_team_id = $1
       AND dta.deleted_at IS NULL
     WHERE ag.deleted_at IS NULL
       AND ag.id IN (
         SELECT ma2.application_group_id
         FROM monitored_applications ma2
         JOIN dev_team_applications dta2
           ON dta2.monitored_app_id = ma2.id
           AND dta2.dev_team_id = $1
           AND dta2.deleted_at IS NULL
         WHERE ma2.application_group_id IS NOT NULL
       )
     GROUP BY ag.id
     ORDER BY ag.name`,
    [devTeamId],
  )
  return rows
}

export async function getUngroupedTeamApps(devTeamId: number): Promise<UngroupedTeamApp[]> {
  const { rows } = await pool.query<UngroupedTeamApp>(
    `SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name
     FROM monitored_applications ma
     JOIN dev_team_applications dta
       ON dta.monitored_app_id = ma.id
       AND dta.dev_team_id = $1
       AND dta.deleted_at IS NULL
     WHERE ma.application_group_id IS NULL
       AND ma.is_active = true
     ORDER BY ma.team_slug, ma.app_name, ma.environment_name`,
    [devTeamId],
  )
  return rows
}

export async function verifyAllUngroupedTeamApps(devTeamId: number, appIds: number[]): Promise<boolean> {
  const uniqueIds = [...new Set(appIds)]
  if (uniqueIds.length === 0) return true
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT ma.id)::int AS count
     FROM monitored_applications ma
     JOIN dev_team_applications dta ON dta.monitored_app_id = ma.id
       AND dta.dev_team_id = $1 AND dta.deleted_at IS NULL
     WHERE ma.id = ANY($2::int[])
       AND ma.application_group_id IS NULL
       AND ma.is_active = true`,
    [devTeamId, uniqueIds],
  )
  return parseInt(String(rows[0]?.count ?? '0'), 10) === uniqueIds.length
}

export async function verifyAllTeamApps(devTeamId: number, appIds: number[]): Promise<boolean> {
  const uniqueIds = [...new Set(appIds)]
  if (uniqueIds.length === 0) return true
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT monitored_app_id)::int AS count
     FROM dev_team_applications
     WHERE dev_team_id = $1
       AND monitored_app_id = ANY($2::int[])
       AND deleted_at IS NULL`,
    [devTeamId, uniqueIds],
  )
  return parseInt(String(rows[0]?.count ?? '0'), 10) === uniqueIds.length
}

export async function isTeamApp(devTeamId: number, monitoredAppId: number): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM dev_team_applications
       WHERE dev_team_id = $1 AND monitored_app_id = $2 AND deleted_at IS NULL
     ) AS exists`,
    [devTeamId, monitoredAppId],
  )
  return rows[0]?.exists ?? false
}

export async function isTeamGroup(devTeamId: number, groupId: number): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM monitored_applications ma
       JOIN dev_team_applications dta ON dta.monitored_app_id = ma.id
         AND dta.dev_team_id = $1 AND dta.deleted_at IS NULL
       WHERE ma.application_group_id = $2
     ) AS exists`,
    [devTeamId, groupId],
  )
  return rows[0]?.exists ?? false
}

export async function getGroupNamesByIds(groupIds: number[]): Promise<Map<number, string>> {
  if (groupIds.length === 0) return new Map()
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM application_groups WHERE id = ANY($1::int[]) AND deleted_at IS NULL',
    [groupIds],
  )
  return new Map(rows.map((r) => [r.id, r.name]))
}

export async function getAppIdsByGroupIds(groupIds: number[]): Promise<Map<number, number[]>> {
  if (groupIds.length === 0) return new Map()

  const result = await pool.query<{ application_group_id: number; id: number }>(
    `SELECT application_group_id, id
     FROM monitored_applications
     WHERE application_group_id = ANY($1)`,
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
