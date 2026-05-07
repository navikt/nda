export const SECTION_ROLES = ['teknologileder', 'seksjonsleder', 'leveranseleder'] as const
export type SectionRole = (typeof SECTION_ROLES)[number]

export const TEAM_ROLES = ['produktleder', 'utvikler'] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

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
