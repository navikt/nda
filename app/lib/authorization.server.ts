import { pool } from '~/db/connection.server'
import { getUserRoles } from '~/db/role-assignments.server'
import type { UserIdentity } from './auth.server'
import type { SectionRole, TeamRole } from './authorization-types'
import { isTeamLeaderRole } from './authorization-types'

function isEntraAdmin(actor: UserIdentity): boolean {
  return actor.role === 'admin'
}

export function canAssignSectionRole(actor: UserIdentity): boolean {
  return isEntraAdmin(actor)
}

export async function canAssignTeamRole(
  actor: UserIdentity,
  devTeamId: number,
  targetRole: TeamRole,
): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const { rows: teamRows } = await pool.query<{ section_id: number }>(
    'SELECT section_id FROM dev_teams WHERE id = $1 AND is_active = true',
    [devTeamId],
  )
  if (teamRows.length === 0) return false
  const teamSectionId = teamRows[0].section_id

  const { sectionRoles, teamRoles } = await getUserRoles(actor.navIdent)

  const hasSectionRole = sectionRoles.some((r) => r.section_id === teamSectionId)
  if (hasSectionRole) return true

  if (targetRole === 'utvikler') {
    return teamRoles.some((r) => r.dev_team_id === devTeamId && isTeamLeaderRole(r.role))
  }

  return false
}

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

export async function canApproveDeployment(actor: UserIdentity, monitoredAppId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const managingTeamIds = await getManagingTeamIds(monitoredAppId)
  if (managingTeamIds.length === 0) return false

  const managingSet = new Set(managingTeamIds)
  const { teamRoles } = await getUserRoles(actor.navIdent)
  return teamRoles.some((r) => managingSet.has(r.dev_team_id))
}

export async function canDeviateDeployment(actor: UserIdentity, monitoredAppId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const managingTeamIds = await getManagingTeamIds(monitoredAppId)
  if (managingTeamIds.length === 0) return false

  const managingSet = new Set(managingTeamIds)
  const { teamRoles } = await getUserRoles(actor.navIdent)
  return teamRoles.some((r) => managingSet.has(r.dev_team_id) && isTeamLeaderRole(r.role))
}

export async function canAdministerTeam(actor: UserIdentity, devTeamId: number): Promise<boolean> {
  if (isEntraAdmin(actor)) return true

  const { teamRoles } = await getUserRoles(actor.navIdent)
  return teamRoles.some((r) => r.dev_team_id === devTeamId && isTeamLeaderRole(r.role))
}

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

export async function getUserSectionRoles(navIdent: string, sectionId: number): Promise<SectionRole[]> {
  const { rows } = await pool.query<{ role: SectionRole }>(
    `SELECT r.role FROM section_role_assignments r
     JOIN sections s ON s.id = r.section_id AND s.is_active = true
     WHERE r.nav_ident = $1 AND r.section_id = $2 AND r.deleted_at IS NULL`,
    [navIdent, sectionId],
  )
  return rows.map((r) => r.role)
}

export async function canSearchUsers(actor: UserIdentity): Promise<boolean> {
  if (isEntraAdmin(actor)) return true
  const { sectionRoles, teamRoles } = await getUserRoles(actor.navIdent)
  return sectionRoles.length > 0 || teamRoles.some((r) => isTeamLeaderRole(r.role))
}

export interface DeploymentCapabilities {
  canApprove: boolean
  canVerify: boolean
  canDeviate: boolean
  canLinkGoal: boolean
  canNotify: boolean
  canLookupLegacy: boolean
  canResetVerification: boolean
}

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
      canResetVerification: true,
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
      canResetVerification: false,
    }
  }

  const managingSet = new Set(managingTeamIds)
  const rolesInManagingTeams = teamRoles.filter((r) => managingSet.has(r.dev_team_id))
  const hasAnyRole = rolesInManagingTeams.length > 0
  const isTeamLeader = rolesInManagingTeams.some((r) => isTeamLeaderRole(r.role))

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
    canResetVerification: false,
  }
}
