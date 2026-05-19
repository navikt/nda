/**
 * Authorization helpers for RBAC role checks.
 *
 * Stateless helpers that query the database to determine whether an actor
 * is allowed to perform a given action. No mutations or side effects.
 * Entra ID admin role is always treated as superadmin.
 */

import { pool } from '~/db/connection.server'
import { getUserRoles } from '~/db/role-assignments.server'
import type { UserIdentity } from './auth.server'
import type { SectionRole, TeamRole } from './authorization-types'
import { isTeamLeaderRole } from './authorization-types'

// ─── Actor context ───────────────────────────────────────────────────────────

/** Checks if the actor is an Entra ID admin (superadmin fallback). */
function isEntraAdmin(actor: UserIdentity): boolean {
  return actor.role === 'admin'
}

// ─── Section role authorization ──────────────────────────────────────────────

/** Only Entra ID admins can assign/remove section-level roles. */
export function canAssignSectionRole(actor: UserIdentity): boolean {
  return isEntraAdmin(actor)
}

// ─── Team role authorization ─────────────────────────────────────────────────

/**
 * Check if actor can assign/remove a team-level role.
 *
 * - Admin: always
 * - Section leaders (teknologileder, seksjonsleder, leveranseleder) in the team's section: always
 * - Team leaders (produktleder/tech_lead) in the team: can assign/remove 'utvikler' only
 */
export async function canAssignTeamRole(
  actor: UserIdentity,
  devTeamId: number,
  targetRole: TeamRole,
): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  // Verify team exists and is active before fetching actor's roles
  const { rows: teamRows } = await pool.query<{ section_id: number }>(
    'SELECT section_id FROM dev_teams WHERE id = $1 AND is_active = true',
    [devTeamId],
  )
  if (teamRows.length === 0) return false
  const teamSectionId = teamRows[0].section_id

  const { sectionRoles, teamRoles } = await getUserRoles(actor.navIdent)

  // Section leaders in the team's section can assign any team role
  const hasSectionRole = sectionRoles.some((r) => r.section_id === teamSectionId)
  if (hasSectionRole) return true

  // Team leaders (produktleder/tech_lead) can assign 'utvikler' only
  if (targetRole === 'utvikler') {
    return teamRoles.some((r) => r.dev_team_id === devTeamId && isTeamLeaderRole(r.role))
  }

  return false
}

// ─── Deployment authorization ────────────────────────────────────────────────

/**
 * Get all dev team IDs that manage a given monitored application.
 * Checks all three linkage paths:
 * 1. dev_team_applications (direct link)
 * 2. dev_team_nais_teams (via nais team → monitored_applications.team_slug)
 * 3. dev_team_application_groups (via application group)
 */
async function getManagingTeamIds(monitoredAppId: number): Promise<number[]> {
  const { rows } = await pool.query<{ dev_team_id: number }>(
    `-- Path 1: Direct app link
     SELECT dta.dev_team_id
     FROM dev_team_applications dta
     JOIN dev_teams dt ON dt.id = dta.dev_team_id AND dt.is_active = true
     JOIN monitored_applications ma ON ma.id = dta.monitored_app_id AND ma.is_active = true
     WHERE dta.monitored_app_id = $1 AND dta.deleted_at IS NULL

     UNION

     -- Path 2: Via nais team
     SELECT dnt.dev_team_id
     FROM dev_team_nais_teams dnt
     JOIN dev_teams dt ON dt.id = dnt.dev_team_id AND dt.is_active = true
     JOIN monitored_applications ma ON ma.team_slug = dnt.nais_team_slug
     WHERE ma.id = $1 AND dnt.deleted_at IS NULL AND ma.is_active = true

     UNION

     -- Path 3: Via application group
     SELECT dtag.dev_team_id
     FROM dev_team_application_groups dtag
     JOIN dev_teams dt ON dt.id = dtag.dev_team_id AND dt.is_active = true
     JOIN application_groups ag ON ag.id = dtag.application_group_id AND ag.deleted_at IS NULL
     JOIN monitored_applications ma ON ma.application_group_id = ag.id
     WHERE ma.id = $1 AND dtag.deleted_at IS NULL AND ma.is_active = true`,
    [monitoredAppId],
  )
  return rows.map((r) => r.dev_team_id)
}

/**
 * Check if the actor can approve/act on a deployment for the given app.
 * Admin or any role (produktleder/utvikler) in one of the managing teams.
 */
export async function canApproveDeployment(actor: UserIdentity, monitoredAppId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const managingTeamIds = await getManagingTeamIds(monitoredAppId)
  if (managingTeamIds.length === 0) return false

  const managingSet = new Set(managingTeamIds)
  const { teamRoles } = await getUserRoles(actor.navIdent)
  return teamRoles.some((r) => managingSet.has(r.dev_team_id))
}

/**
 * Check if the actor can register deviations or perform elevated actions.
 * Admin or team leader (produktleder/tech_lead) in one of the managing teams.
 */
export async function canDeviateDeployment(actor: UserIdentity, monitoredAppId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const managingTeamIds = await getManagingTeamIds(monitoredAppId)
  if (managingTeamIds.length === 0) return false

  const managingSet = new Set(managingTeamIds)
  const { teamRoles } = await getUserRoles(actor.navIdent)
  return teamRoles.some((r) => managingSet.has(r.dev_team_id) && isTeamLeaderRole(r.role))
}

// ─── Team administration ─────────────────────────────────────────────────────

/**
 * Check if the actor can administer a dev team (admin page, boards, members).
 * Admin or team leader (produktleder/tech_lead) in the team.
 */
export async function canAdministerTeam(actor: UserIdentity, devTeamId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const { teamRoles } = await getUserRoles(actor.navIdent)
  return teamRoles.some((r) => r.dev_team_id === devTeamId && isTeamLeaderRole(r.role))
}

/**
 * Check if the actor can access the team admin page.
 * Allowed for: admin, team leader (produktleder/tech_lead) in the team, or section leaders in the team's section.
 */
export async function canAccessTeamAdmin(actor: UserIdentity, devTeamId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const { rows: teamRows } = await pool.query<{ section_id: number }>(
    'SELECT section_id FROM dev_teams WHERE id = $1 AND is_active = true',
    [devTeamId],
  )
  if (teamRows.length === 0) return false
  const teamSectionId = teamRows[0].section_id

  const { sectionRoles, teamRoles } = await getUserRoles(actor.navIdent)

  if (sectionRoles.some((r) => r.section_id === teamSectionId)) return true

  return teamRoles.some((r) => r.dev_team_id === devTeamId && isTeamLeaderRole(r.role))
}

interface TeamAdminCapabilities {
  canAccess: boolean
  canAdmin: boolean
}

/**
 * Resolve team admin capabilities in a single pass (one getUserRoles call).
 * Returns { canAccess, canAdmin } to avoid redundant DB queries.
 */
export async function resolveTeamAdminCapabilities(
  actor: UserIdentity,
  devTeamId: number,
): Promise<TeamAdminCapabilities> {
  if (isEntraAdmin(actor)) return { canAccess: true, canAdmin: true }

  const { rows: teamRows } = await pool.query<{ section_id: number }>(
    'SELECT section_id FROM dev_teams WHERE id = $1 AND is_active = true',
    [devTeamId],
  )
  if (teamRows.length === 0) return { canAccess: false, canAdmin: false }
  const teamSectionId = teamRows[0].section_id

  const { sectionRoles, teamRoles } = await getUserRoles(actor.navIdent)

  const isTeamLeader = teamRoles.some((r) => r.dev_team_id === devTeamId && isTeamLeaderRole(r.role))
  const isSectionLeader = sectionRoles.some((r) => r.section_id === teamSectionId)

  return {
    canAccess: isTeamLeader || isSectionLeader,
    canAdmin: isTeamLeader,
  }
}

/**
 * Check if the actor has any active role in the given team.
 */
export async function isTeamMember(navIdent: string, devTeamId: number): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM dev_team_role_assignments r
       JOIN dev_teams dt ON dt.id = r.dev_team_id AND dt.is_active = true
       WHERE r.nav_ident = $1 AND r.dev_team_id = $2 AND r.deleted_at IS NULL
     ) AS exists`,
    [navIdent, devTeamId],
  )
  return rows[0].exists
}

/**
 * Get the section roles for a user in a specific section.
 * @public Used by section-roles admin page (Branch 2)
 */
export async function getUserSectionRoles(navIdent: string, sectionId: number): Promise<SectionRole[]> {
  const { rows } = await pool.query<{ role: SectionRole }>(
    `SELECT r.role FROM section_role_assignments r
     JOIN sections s ON s.id = r.section_id AND s.is_active = true
     WHERE r.nav_ident = $1 AND r.section_id = $2 AND r.deleted_at IS NULL`,
    [navIdent, sectionId],
  )
  return rows.map((r) => r.role)
}

// ─── Deployment capabilities (single-pass) ──────────────────────────────────

/** Check if the actor has any role that allows user search (admin, section role, or team leader). */
export async function canSearchUsers(actor: UserIdentity): Promise<boolean> {
  if (isEntraAdmin(actor)) return true
  const { sectionRoles, teamRoles } = await getUserRoles(actor.navIdent)
  return sectionRoles.length > 0 || teamRoles.some((r) => isTeamLeaderRole(r.role))
}

export interface DeploymentCapabilities {
  /** Approve/reject deployments, manage legacy info, approve baseline */
  canApprove: boolean
  /** Trigger four-eyes verification (team member, teknologileder, or admin) */
  canVerify: boolean
  /** Register deviations, delete comments */
  canDeviate: boolean
  /** Link/unlink deployments to goals */
  canLinkGoal: boolean
  /** Send Slack notifications */
  canNotify: boolean
  /** Look up legacy GitHub data */
  canLookupLegacy: boolean
}

/**
 * Resolve all deployment capabilities for an actor in a single pass.
 * Uses one getUserRoles() call + one getManagingTeamIds() call (in parallel).
 *
 * Intent → capability mapping:
 * - canApprove:      manual_approval, confirm_legacy_lookup, register_legacy_info,
 *                    approve_legacy, reject_legacy, approve_baseline
 * - canVerify:       verify_four_eyes (team member, teknologileder in app's section, or admin)
 * - canDeviate:      register_deviation, delete_comment
 * - canLinkGoal:     link_goal, unlink_goal
 * - canNotify:       send_slack_notification
 * - canLookupLegacy: lookup_legacy_github
 * - (no gate):       add_comment (any authenticated user)
 */
export async function resolveDeploymentCapabilities(
  actor: UserIdentity,
  monitoredAppId: number,
): Promise<DeploymentCapabilities> {
  if (isEntraAdmin(actor)) {
    return {
      canApprove: true,
      canVerify: true,
      canDeviate: true,
      canLinkGoal: true,
      canNotify: true,
      canLookupLegacy: true,
    }
  }

  const [managingTeamIds, { teamRoles, sectionRoles }] = await Promise.all([
    getManagingTeamIds(monitoredAppId),
    getUserRoles(actor.navIdent),
  ])

  if (managingTeamIds.length === 0) {
    return {
      canApprove: false,
      canVerify: false,
      canDeviate: false,
      canLinkGoal: false,
      canNotify: false,
      canLookupLegacy: false,
    }
  }

  const managingSet = new Set(managingTeamIds)
  const rolesInManagingTeams = teamRoles.filter((r) => managingSet.has(r.dev_team_id))
  const hasAnyRole = rolesInManagingTeams.length > 0
  const isTeamLeader = rolesInManagingTeams.some((r) => isTeamLeaderRole(r.role))

  // Check if user is teknologileder in the section(s) that own the managing teams
  const isTechnologileder = await (async () => {
    if (sectionRoles.length === 0) return false
    const teknologilederSections = new Set(
      sectionRoles.filter((r) => r.role === 'teknologileder').map((r) => r.section_id),
    )
    if (teknologilederSections.size === 0) return false
    const { rows } = await pool.query<{ section_id: number }>(
      'SELECT DISTINCT section_id FROM dev_teams WHERE id = ANY($1) AND is_active = true',
      [managingTeamIds],
    )
    return rows.some((r) => teknologilederSections.has(r.section_id))
  })()

  return {
    canApprove: hasAnyRole,
    canVerify: hasAnyRole || isTechnologileder,
    canDeviate: isTeamLeader,
    canLinkGoal: hasAnyRole,
    canNotify: hasAnyRole,
    canLookupLegacy: hasAnyRole,
  }
}
