/**
 * Application Groups
 *
 * Groups multiple monitored_applications that represent the same logical
 * application deployed to different NAIS clusters or teams.
 *
 * When a deployment is verified in one cluster, the verification status
 * can be propagated to sibling deployments with the same commit SHA.
 */
import { pool } from './connection.server'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApplicationGroup {
  id: number
  name: string
  created_at: Date
}

export interface ApplicationGroupWithApps extends ApplicationGroup {
  apps: Array<{
    id: number
    team_slug: string
    environment_name: string
    app_name: string
  }>
}

export interface ApplicationGroupSummary extends ApplicationGroup {
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

// Statuses that indicate a deployment is still awaiting verification
const PENDING_STATUSES = ['pending', 'error']

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

export async function removeAppFromGroup(monitoredAppId: number): Promise<void> {
  await pool.query('UPDATE monitored_applications SET application_group_id = NULL WHERE id = $1', [monitoredAppId])
}

export async function getGroupWithApps(groupId: number): Promise<ApplicationGroupWithApps | null> {
  const { rows: groupRows } = await pool.query<ApplicationGroup>('SELECT * FROM application_groups WHERE id = $1', [
    groupId,
  ])
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
     WHERE ma.id = $1`,
    [monitoredAppId],
  )
  return rows[0] ?? null
}

export async function getSiblingApps(
  monitoredAppId: number,
): Promise<Array<{ id: number; team_slug: string; environment_name: string; app_name: string }>> {
  const { rows } = await pool.query<{
    id: number
    team_slug: string
    environment_name: string
    app_name: string
  }>(
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

export async function deleteGroup(groupId: number): Promise<void> {
  await pool.query('DELETE FROM application_groups WHERE id = $1', [groupId])
}

export async function getAllGroups(): Promise<ApplicationGroupSummary[]> {
  const { rows } = await pool.query<ApplicationGroupSummary>(
    `SELECT ag.*, COUNT(ma.id)::int AS app_count
     FROM application_groups ag
     LEFT JOIN monitored_applications ma ON ma.application_group_id = ag.id
     GROUP BY ag.id
     ORDER BY ag.name`,
  )
  return rows
}

// ─── Verification propagation ────────────────────────────────────────────────

/**
 * Propagate a positive verification status to sibling deployments that:
 * 1. Belong to apps in the same application group
 * 2. Have the same commit SHA
 * 3. Are still in a pending/error state
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
  const hasFourEyes = true

  const result = await pool.query(
    `UPDATE deployments
     SET has_four_eyes = $1,
         four_eyes_status = $2
     WHERE commit_sha = $3
       AND four_eyes_status = ANY($4::text[])
       AND id != $5
       AND monitored_app_id IN (
         SELECT ma.id FROM monitored_applications ma
         WHERE ma.application_group_id = (
           SELECT application_group_id FROM monitored_applications WHERE id = $6
         )
         AND ma.application_group_id IS NOT NULL
         AND ma.id != $6
       )`,
    [hasFourEyes, status, commitSha, PENDING_STATUSES, deploymentId, monitoredAppId],
  )

  return result.rowCount ?? 0
}
