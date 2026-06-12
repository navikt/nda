/**
 * Application Groups
 *
 * Groups multiple monitored_applications that represent the same logical
 * application deployed to different NAIS clusters or teams.
 *
 * When a deployment is verified in one cluster, the verification status
 * can be propagated to sibling deployments with the same commit SHA.
 */
import { REVERIFIABLE_STATUSES } from '~/lib/four-eyes-status'
import { pool } from './connection.server'

// ─── Types ───────────────────────────────────────────────────────────────────

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

// Statuses that are safe to propagate to sibling deployments
const PROPAGATABLE_STATUSES = new Set([
  'approved',
  'approved_pr_with_unreviewed',
  'implicitly_approved',
  'no_changes',
  'manually_approved',
])

// Statuses eligible for propagation: reverifiable pending + error (verification failure, can be retried)
const PROPAGATION_TARGET_STATUSES = [...REVERIFIABLE_STATUSES, 'error']

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function createApplicationGroup(name: string): Promise<ApplicationGroup> {
  const { rows } = await pool.query<ApplicationGroup>('INSERT INTO application_groups (name) VALUES ($1) RETURNING *', [
    name,
  ])
  return rows[0]
}

export async function addAppToGroup(groupId: number, monitoredAppId: number): Promise<void> {
  await pool.query('UPDATE monitored_applications SET application_group_id = $1 WHERE id = $2', [
    groupId,
    monitoredAppId,
  ])
}

/**
 * Atomically add a team app to a group, verifying ungrouped+active+team-membership in the same SQL.
 * Returns false if the app was already grouped, inactive, or no longer belongs to the team (TOCTOU-safe).
 */
export async function addTeamAppToGroupConditional(
  groupId: number,
  appId: number,
  devTeamId: number,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE monitored_applications
     SET application_group_id = $1
     WHERE id = $2
       AND application_group_id IS NULL
       AND is_active = true
       AND EXISTS (
         SELECT 1 FROM dev_team_applications
         WHERE dev_team_id = $3 AND monitored_app_id = $2 AND deleted_at IS NULL
       )
       AND EXISTS (
         SELECT 1 FROM application_groups
         WHERE id = $1 AND deleted_at IS NULL
       )`,
    [groupId, appId, devTeamId],
  )
  return (result.rowCount ?? 0) > 0
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

/**
 * Get an app's group and its siblings in a single SQL query.
 * Returns `{ group: null, siblings: [] }` for ungrouped apps.
 */
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

/**
 * Soft-delete an application group.
 *
 * Sets deleted_at/deleted_by on the group row (preserving it for audit
 * reports) and clears application_group_id on all linked monitored
 * applications so they appear "ungrouped" in current-state UI listings.
 * Both updates run in a single transaction.
 */
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

/**
 * Get all application groups that contain at least one app belonging to the given dev team.
 * Returns each group with its full app list, where `is_team_app` marks apps owned by the team.
 */
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

/**
 * Get monitored applications that belong to the given dev team and are not in any group.
 */
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

/**
 * Verify that a monitored application belongs to a dev team AND is ungrouped and active.
 * Used for IDOR protection before adding an app to a group.
 */
export async function isUngroupedTeamApp(devTeamId: number, monitoredAppId: number): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM monitored_applications ma
       JOIN dev_team_applications dta ON dta.monitored_app_id = ma.id
         AND dta.dev_team_id = $1 AND dta.deleted_at IS NULL
       WHERE ma.id = $2
         AND ma.application_group_id IS NULL
         AND ma.is_active = true
     ) AS exists`,
    [devTeamId, monitoredAppId],
  )
  return rows[0]?.exists ?? false
}

/**
 * Verify that ALL given monitored app IDs belong to a dev team AND are ungrouped and active.
 * Used for IDOR protection before creating a group from manually selected apps.
 */
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

/**
 * Verify that ALL given monitored app IDs belong to a dev team in a single query.
 * Handles duplicates by deduplicating before the count comparison.
 */
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

/**
 * Verify that a monitored application belongs to a dev team.
 * Used for IDOR protection in team-scoped group mutations.
 */
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

/**
 * Verify that an application group contains at least one app belonging to a dev team.
 * Used for IDOR protection in team-scoped group mutations (add, delete).
 */
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

/** Get group names by IDs — lightweight lookup for UI labels */
export async function getGroupNamesByIds(groupIds: number[]): Promise<Map<number, string>> {
  if (groupIds.length === 0) return new Map()
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM application_groups WHERE id = ANY($1::int[]) AND deleted_at IS NULL',
    [groupIds],
  )
  return new Map(rows.map((r) => [r.id, r.name]))
}

// ─── Verification propagation ────────────────────────────────────────────────

/**
 * Propagate a positive verification status to sibling deployments that:
 * 1. Belong to apps in the same application group
 * 2. Have the same commit SHA
 * 3. Are still in a pending state (any canonical pending status) or error state
 *
 * Returns the number of sibling deployments updated.
 */
export async function propagateVerificationToSiblings(
  deploymentId: number,
  status: string,
  commitSha: string,
  monitoredAppId: number,
): Promise<number> {
  if (!PROPAGATABLE_STATUSES.has(status)) return 0

  // All propagatable statuses imply four-eyes compliance.
  // The single UPDATE statement is atomic in PostgreSQL — concurrent
  // propagation attempts targeting the same row are serialized by
  // row-level locking, and the WHERE clause ensures only pending/error
  // deployments are updated.
  const result = await pool.query(
    `UPDATE deployments
     SET four_eyes_status = $1
     WHERE commit_sha = $2
       AND four_eyes_status = ANY($3::text[])
       AND id != $4
       AND monitored_app_id IN (
         SELECT ma.id FROM monitored_applications ma
         WHERE ma.application_group_id = (
           SELECT application_group_id FROM monitored_applications WHERE id = $5
         )
         AND ma.application_group_id IS NOT NULL
         AND ma.id != $5
       )`,
    [status, commitSha, PROPAGATION_TARGET_STATUSES, deploymentId, monitoredAppId],
  )

  return result.rowCount ?? 0
}

/**
 * Get all app IDs belonging to the given application group IDs.
 * Includes inactive apps to match the deployment route's getGroupContext()
 * which does not filter by is_active when expanding group siblings.
 */
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
