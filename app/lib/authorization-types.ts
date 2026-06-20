export const SECTION_ROLES = ['teknologileder', 'seksjonsleder', 'leveranseleder'] as const
export type SectionRole = (typeof SECTION_ROLES)[number]

export const TEAM_ROLES = ['produktleder', 'tech_lead', 'utvikler'] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

const TEAM_LEADER_ROLES: readonly TeamRole[] = ['produktleder', 'tech_lead'] as const

export function isTeamLeaderRole(role: string): boolean {
  return (TEAM_LEADER_ROLES as readonly string[]).includes(role)
}

export const SECTION_ROLE_LABELS: Record<string, string> = {
  teknologileder: 'Teknologileder',
  seksjonsleder: 'Seksjonsleder',
  leveranseleder: 'Leveranseleder',
} satisfies Record<SectionRole, string>

export const TEAM_ROLE_LABELS: Record<string, string> = {
  produktleder: 'Produktleder',
  tech_lead: 'Tech Lead',
  utvikler: 'Utvikler',
} satisfies Record<TeamRole, string>

export interface SectionRoleAssignment {
  id: number
  nav_ident: string
  section_id: number
  role: SectionRole
  assigned_by: string
  assigned_at: Date
}

export interface TeamRoleAssignment {
  id: number
  nav_ident: string
  dev_team_id: number
  role: TeamRole
  assigned_by: string
  assigned_at: Date
}

export interface UserRoles {
  sectionRoles: SectionRoleAssignment[]
  teamRoles: TeamRoleAssignment[]
}
