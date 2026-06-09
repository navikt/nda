import type {
  SectionRole,
  SectionRoleAssignment,
  TeamRole,
  TeamRoleAssignment,
  UserRoles,
} from '~/lib/authorization-types'
import { pool } from './connection.server'

// ─── Section role assignments ────────────────────────────────────────────────

export async function assignSectionRole(
  navIdent: string,
  sectionId: number,
  role: SectionRole,
  assignedBy: string,
): Promise<SectionRoleAssignment | null> {
  const normalizedIdent = navIdent.toUpperCase()
  // INSERT...SELECT FROM users eliminates the TOCTOU window between the
  // pre-check in the route action and this insert: if the user is deleted
  // between the two calls the SELECT returns no rows and no role is assigned.
  const { rows } = await pool.query<SectionRoleAssignment>(
    `INSERT INTO section_role_assignments (nav_ident, section_id, role, assigned_by)
     SELECT $1, $2, $3, $4
     FROM users
     WHERE nav_ident = $1 AND deleted_at IS NULL
     ON CONFLICT (nav_ident, section_id, role) WHERE deleted_at IS NULL DO NOTHING
     RETURNING *`,
    [normalizedIdent, sectionId, role, assignedBy],
  )
  return rows[0] ?? null
}

export async function removeSectionRole(assignmentId: number, deletedBy: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE section_role_assignments
     SET deleted_at = NOW(), deleted_by = $2
     WHERE id = $1 AND deleted_at IS NULL`,
    [assignmentId, deletedBy],
  )
  return (rowCount ?? 0) > 0
}

/** @public Used by section-roles admin page (Branch 2) */
export async function getSectionRoleAssignments(sectionId: number): Promise<SectionRoleAssignment[]> {
  const { rows } = await pool.query<SectionRoleAssignment>(
    `SELECT r.id, r.nav_ident, r.section_id, r.role, r.assigned_by, r.assigned_at
     FROM section_role_assignments r
     JOIN sections s ON s.id = r.section_id AND s.is_active = true
     WHERE r.section_id = $1 AND r.deleted_at IS NULL
     ORDER BY r.role, r.nav_ident`,
    [sectionId],
  )
  return rows
}

/**
 * Get all section role assignments grouped by nav_ident.
 * @public Used by admin user listing (Branch 2)
 */
export async function getAllSectionRoleAssignments(): Promise<
  Map<string, Array<{ section_id: number; section_name: string; role: SectionRole }>>
> {
  const { rows } = await pool.query<{ nav_ident: string; section_id: number; section_name: string; role: SectionRole }>(
    `SELECT r.nav_ident, r.section_id, s.name AS section_name, r.role
     FROM section_role_assignments r
     JOIN sections s ON s.id = r.section_id AND s.is_active = true
     WHERE r.deleted_at IS NULL
     ORDER BY r.nav_ident, s.name`,
  )
  const map = new Map<string, Array<{ section_id: number; section_name: string; role: SectionRole }>>()
  for (const row of rows) {
    const key = row.nav_ident.toUpperCase()
    const existing = map.get(key) ?? []
    existing.push({ section_id: row.section_id, section_name: row.section_name, role: row.role })
    map.set(key, existing)
  }
  return map
}

// ─── Team role assignments ───────────────────────────────────────────────────

export async function assignTeamRole(
  navIdent: string,
  devTeamId: number,
  role: TeamRole,
  assignedBy: string,
): Promise<TeamRoleAssignment | null> {
  const normalizedIdent = navIdent.toUpperCase()
  // INSERT...SELECT FROM users eliminates the TOCTOU window between the
  // pre-check in the route action and this insert: if the user is deleted
  // between the two calls the SELECT returns no rows and no role is assigned.
  const { rows } = await pool.query<TeamRoleAssignment>(
    `INSERT INTO dev_team_role_assignments (nav_ident, dev_team_id, role, assigned_by)
     SELECT $1, $2, $3, $4
     FROM users
     WHERE nav_ident = $1 AND deleted_at IS NULL
     ON CONFLICT (nav_ident, dev_team_id, role) WHERE deleted_at IS NULL DO NOTHING
     RETURNING *`,
    [normalizedIdent, devTeamId, role, assignedBy],
  )
  return rows[0] ?? null
}

export async function removeTeamRole(assignmentId: number, deletedBy: string, devTeamId?: number): Promise<boolean> {
  const params: (number | string)[] = [assignmentId, deletedBy]
  let whereClause = 'WHERE id = $1 AND deleted_at IS NULL'
  if (devTeamId != null) {
    whereClause += ' AND dev_team_id = $3'
    params.push(devTeamId)
  }
  const { rowCount } = await pool.query(
    `UPDATE dev_team_role_assignments
     SET deleted_at = NOW(), deleted_by = $2
     ${whereClause}`,
    params,
  )
  return (rowCount ?? 0) > 0
}

export async function getTeamRoleAssignmentById(
  assignmentId: number,
  devTeamId: number,
): Promise<TeamRoleAssignment | null> {
  const { rows } = await pool.query<TeamRoleAssignment>(
    `SELECT id, nav_ident, dev_team_id, role, assigned_by, assigned_at
     FROM dev_team_role_assignments
     WHERE id = $1 AND dev_team_id = $2 AND deleted_at IS NULL`,
    [assignmentId, devTeamId],
  )
  return rows[0] ?? null
}

export async function getTeamRoleAssignments(devTeamId: number): Promise<TeamRoleAssignment[]> {
  const { rows } = await pool.query<TeamRoleAssignment>(
    `SELECT r.id, r.nav_ident, r.dev_team_id, r.role, r.assigned_by, r.assigned_at
     FROM dev_team_role_assignments r
     JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
     WHERE r.dev_team_id = $1 AND r.deleted_at IS NULL
     ORDER BY r.role, r.nav_ident`,
    [devTeamId],
  )
  return rows
}

// ─── User role queries ───────────────────────────────────────────────────────

export async function getUserRoles(navIdent: string): Promise<UserRoles> {
  const [sectionResult, teamResult] = await Promise.all([
    pool.query<SectionRoleAssignment>(
      `SELECT r.id, r.nav_ident, r.section_id, r.role, r.assigned_by, r.assigned_at
       FROM section_role_assignments r
       JOIN sections s ON s.id = r.section_id AND s.is_active = true
       WHERE r.nav_ident = $1 AND r.deleted_at IS NULL
       ORDER BY r.section_id, r.role`,
      [navIdent],
    ),
    pool.query<TeamRoleAssignment>(
      `SELECT r.id, r.nav_ident, r.dev_team_id, r.role, r.assigned_by, r.assigned_at
       FROM dev_team_role_assignments r
       JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
       WHERE r.nav_ident = $1 AND r.deleted_at IS NULL
       ORDER BY r.dev_team_id, r.role`,
      [navIdent],
    ),
  ])
  return {
    sectionRoles: sectionResult.rows,
    teamRoles: teamResult.rows,
  }
}

export interface UserRoleDisplay {
  sectionRoles: Array<{ role: SectionRole; sectionName: string; sectionSlug: string }>
  teamRoles: Array<{ role: TeamRole; teamName: string; teamSlug: string; sectionSlug: string | null }>
}

/**
 * Get all active roles for a user with display-friendly names.
 * Used by user profile page for read-only role display.
 */
export async function getUserRolesForDisplay(navIdent: string): Promise<UserRoleDisplay> {
  const [sectionResult, teamResult] = await Promise.all([
    pool.query<{ role: SectionRole; section_name: string; section_slug: string }>(
      `SELECT r.role, s.name as section_name, s.slug as section_slug
       FROM section_role_assignments r
       JOIN sections s ON s.id = r.section_id AND s.is_active = true
       WHERE r.nav_ident = $1 AND r.deleted_at IS NULL
       ORDER BY s.name, r.role`,
      [navIdent],
    ),
    pool.query<{ role: TeamRole; team_name: string; team_slug: string; section_slug: string | null }>(
      `SELECT r.role, dt.name as team_name, dt.slug as team_slug, s.slug as section_slug
       FROM dev_team_role_assignments r
       JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
       LEFT JOIN sections s ON s.id = dt.section_id AND s.is_active = true
       WHERE r.nav_ident = $1 AND r.deleted_at IS NULL
       ORDER BY dt.name, r.role`,
      [navIdent],
    ),
  ])
  return {
    sectionRoles: sectionResult.rows.map((r) => ({
      role: r.role,
      sectionName: r.section_name,
      sectionSlug: r.section_slug,
    })),
    teamRoles: teamResult.rows.map((r) => ({
      role: r.role,
      teamName: r.team_name,
      teamSlug: r.team_slug,
      sectionSlug: r.section_slug,
    })),
  }
}

export interface DevTeamMemberWithRole {
  id: number
  nav_ident: string
  role: TeamRole
  github_username: string | null
  display_github_username: string | null
  display_name: string | null
  assigned_at: Date
}

/**
 * Get all members of a dev team with their roles.
 * Both tables store nav_ident as uppercase, so plain equality is used.
 */
export async function getDevTeamMembersWithRoles(devTeamId: number): Promise<DevTeamMemberWithRole[]> {
  const { rows } = await pool.query<DevTeamMemberWithRole>(
    `SELECT r.id, r.nav_ident, r.role,
            uga.github_username, uga.display_github_username,
            COALESCE(u.display_name, uga.display_name) AS display_name,
            r.assigned_at
     FROM dev_team_role_assignments r
     JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
     LEFT JOIN users u ON u.nav_ident = r.nav_ident
     LEFT JOIN LATERAL (
       SELECT github_username, display_github_username, display_name
       FROM user_github_accounts
       WHERE nav_ident = r.nav_ident AND deleted_at IS NULL
       ORDER BY is_primary DESC, updated_at DESC NULLS LAST
       LIMIT 1
     ) uga ON TRUE
     WHERE r.dev_team_id = $1 AND r.deleted_at IS NULL
     ORDER BY r.role, COALESCE(u.display_name, uga.display_name, r.nav_ident)`,
    [devTeamId],
  )
  return rows
}

/**
 * Get the unique GitHub usernames of all role-assigned members across the given dev teams.
 * Replacement for getMembersGithubUsernamesForDevTeams in user-dev-team-preference.
 * @public Used by deployment team filter (Branch 3)
 */
export async function getMembersGithubUsernamesForDevTeamRoles(devTeamIds: number[]): Promise<string[]> {
  if (devTeamIds.length === 0) return []
  const { rows } = await pool.query<{ github_username: string }>(
    `SELECT DISTINCT uga.github_username
     FROM dev_team_role_assignments r
     JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
     JOIN user_github_accounts uga
       ON uga.nav_ident = r.nav_ident AND uga.deleted_at IS NULL
     WHERE r.dev_team_id = ANY($1::int[])
       AND r.deleted_at IS NULL`,
    [devTeamIds],
  )
  return rows.map((r) => r.github_username)
}

/**
 * Find active dev teams that have at least one role-assigned member whose GitHub username
 * is in the given set. Replacement for getDevTeamsForGithubUsernames in user-dev-team-preference.
 * @public Used by deployment team filter (Branch 3)
 */
export async function getDevTeamsForGithubUsernamesByRole(
  githubUsernames: string[],
): Promise<Array<{ id: number; slug: string; name: string }>> {
  if (githubUsernames.length === 0) return []
  const { rows } = await pool.query<{ id: number; slug: string; name: string }>(
    `SELECT DISTINCT dt.id, dt.slug, dt.name
     FROM dev_team_role_assignments r
     JOIN user_github_accounts uga
       ON uga.nav_ident = r.nav_ident AND uga.deleted_at IS NULL
     JOIN dev_teams dt
       ON dt.id = r.dev_team_id AND dt.is_active = true
     WHERE r.deleted_at IS NULL
       AND LOWER(uga.github_username) = ANY($1)`,
    [githubUsernames.map((u) => u.toLowerCase())],
  )
  return rows
}

/**
 * Get all role assignments for admin user listing.
 * Returns a map of nav_ident → array of { dev_team_id, role }.
 * @public Used by admin user listing (Branch 2)
 */
export async function getAllUserRoleAssignments(): Promise<
  Map<string, Array<{ dev_team_id: number; role: TeamRole }>>
> {
  const { rows } = await pool.query<{ nav_ident: string; dev_team_id: number; role: TeamRole }>(
    `SELECT r.nav_ident, r.dev_team_id, r.role
     FROM dev_team_role_assignments r
     JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
     WHERE r.deleted_at IS NULL
     ORDER BY r.nav_ident, dt.name`,
  )
  const map = new Map<string, Array<{ dev_team_id: number; role: TeamRole }>>()
  for (const row of rows) {
    const key = row.nav_ident.toUpperCase()
    const existing = map.get(key) ?? []
    existing.push({ dev_team_id: row.dev_team_id, role: row.role })
    map.set(key, existing)
  }
  return map
}

/**
 * Get dev teams the user has any active role in (with nais_team_slugs).
 * Replacement for getUserDevTeams in user-dev-team-preference.
 * Returns one row per team with all roles aggregated.
 * @public Used by my-teams and my-apps (Branch 3)
 */
export async function getUserDevTeamsByRole(navIdent: string): Promise<
  Array<{
    id: number
    section_id: number
    slug: string
    name: string
    is_active: boolean
    created_at: Date
    nais_team_slugs: string[]
    section_slug: string | null
    roles: TeamRole[]
  }>
> {
  const { rows } = await pool.query(
    `SELECT dt.*, s.slug as section_slug,
       COALESCE(array_agg(DISTINCT dn.nais_team_slug ORDER BY dn.nais_team_slug) FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs,
       array_agg(DISTINCT r.role ORDER BY r.role) as roles
     FROM dev_team_role_assignments r
     JOIN dev_teams dt ON dt.id = r.dev_team_id
     LEFT JOIN sections s ON s.id = dt.section_id AND s.is_active = true
     LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id AND dn.deleted_at IS NULL
     WHERE r.nav_ident = $1 AND r.deleted_at IS NULL AND dt.is_active = true
     GROUP BY dt.id, s.slug
     ORDER BY dt.name`,
    [navIdent],
  )
  return rows
}
