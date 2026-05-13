/**
 * Integration tests for RBAC authorization helpers.
 *
 * Tests cover:
 * - Section role assignment authorization (admin-only)
 * - Team role assignment authorization (admin, section leaders, produktleder)
 * - Deployment authorization via all 3 app linkage paths
 * - Deviation authorization (produktleder-only)
 * - Team administration authorization
 * - Team membership checks
 * - Soft-delete behavior (deleted roles should not grant access)
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  assignSectionRole,
  assignTeamRole,
  getDevTeamMembersWithRoles,
  getDevTeamsForGithubUsernamesByRole,
  getMembersGithubUsernamesForDevTeamRoles,
  getTeamRoleAssignmentById,
  getTeamRoleAssignments,
  getUserRoles,
  removeSectionRole,
  removeTeamRole,
} from '~/db/role-assignments.server'
import type { UserIdentity } from '~/lib/auth.server'
import {
  canAccessTeamAdmin,
  canAdministerTeam,
  canApproveDeployment,
  canAssignSectionRole,
  canAssignTeamRole,
  canDeviateDeployment,
  isTeamMember,
  resolveDeploymentCapabilities,
  resolveTeamAdminCapabilities,
} from '~/lib/authorization.server'
import { seedApp, seedDevTeam, seedSection, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})
afterEach(async () => {
  await truncateAllTables(pool)
})

// ─── Test helpers ────────────────────────────────────────────────────────────

function defined<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected value to be defined')
  return value
}

function makeAdmin(navIdent = 'A123456'): UserIdentity {
  return { navIdent, role: 'admin', entraGroups: [] }
}

function makeUser(navIdent = 'B654321'): UserIdentity {
  return { navIdent, role: 'user', entraGroups: [] }
}

// ─── Section role assignment authorization ───────────────────────────────────

describe('canAssignSectionRole', () => {
  it('allows admin', () => {
    expect(canAssignSectionRole(makeAdmin())).toBe(true)
  })

  it('denies regular user', () => {
    expect(canAssignSectionRole(makeUser())).toBe(false)
  })
})

// ─── Team role assignment authorization ──────────────────────────────────────

describe('canAssignTeamRole', () => {
  it('allows admin for any role', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    expect(await canAssignTeamRole(makeAdmin(), teamId, 'produktleder')).toBe(true)
    expect(await canAssignTeamRole(makeAdmin(), teamId, 'utvikler')).toBe(true)
  })

  it('allows section leader to assign any team role', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const leader = makeUser('L111111')
    await assignSectionRole(leader.navIdent, sectionId, 'teknologileder', 'admin')

    expect(await canAssignTeamRole(leader, teamId, 'produktleder')).toBe(true)
    expect(await canAssignTeamRole(leader, teamId, 'utvikler')).toBe(true)
  })

  it('denies section leader for team in different section', async () => {
    const section1 = await seedSection(pool, 'pensjon')
    const section2 = await seedSection(pool, 'arbeid')
    const teamInSection2 = await seedDevTeam(pool, 'team-b', 'Team B', section2)

    const leader = makeUser('L111111')
    await assignSectionRole(leader.navIdent, section1, 'seksjonsleder', 'admin')

    expect(await canAssignTeamRole(leader, teamInSection2, 'utvikler')).toBe(false)
  })

  it('allows produktleder to assign utvikler', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const pl = makeUser('P222222')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')

    expect(await canAssignTeamRole(pl, teamId, 'utvikler')).toBe(true)
  })

  it('denies produktleder from assigning produktleder', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const pl = makeUser('P222222')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')

    expect(await canAssignTeamRole(pl, teamId, 'produktleder')).toBe(false)
  })

  it('allows tech_lead to assign utvikler', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const tl = makeUser('T222222')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')

    expect(await canAssignTeamRole(tl, teamId, 'utvikler')).toBe(true)
  })

  it('denies tech_lead from assigning produktleder', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const tl = makeUser('T222222')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')

    expect(await canAssignTeamRole(tl, teamId, 'produktleder')).toBe(false)
  })

  it('denies tech_lead from assigning tech_lead', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const tl = makeUser('T222222')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')

    expect(await canAssignTeamRole(tl, teamId, 'tech_lead')).toBe(false)
  })

  it('denies regular user without any roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    expect(await canAssignTeamRole(makeUser(), teamId, 'utvikler')).toBe(false)
  })

  it('denies after section role is soft-deleted', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const leader = makeUser('L333333')
    const assignment = await assignSectionRole(leader.navIdent, sectionId, 'leveranseleder', 'admin')
    expect(await canAssignTeamRole(leader, teamId, 'utvikler')).toBe(true)

    await removeSectionRole(defined(assignment).id, 'admin')
    expect(await canAssignTeamRole(leader, teamId, 'utvikler')).toBe(false)
  })
})

// ─── Deployment authorization ────────────────────────────────────────────────

describe('canApproveDeployment', () => {
  it('allows admin', async () => {
    const _sectionId = await seedSection(pool, 'pensjon')
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    expect(await canApproveDeployment(makeAdmin(), appId)).toBe(true)
  })

  it('allows team member via direct app link', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    // Link app to team
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D444444')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')

    expect(await canApproveDeployment(dev, appId)).toBe(true)
  })

  it('allows team member via nais team link', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'my-nais-team', appName: 'myapp', environment: 'prod-gcp' })

    // Link nais team to dev team
    await pool.query('INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)', [
      teamId,
      'my-nais-team',
    ])

    const dev = makeUser('D555555')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')

    expect(await canApproveDeployment(dev, appId)).toBe(true)
  })

  it('allows team member via application group link', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    // Create application group and link
    const {
      rows: [group],
    } = await pool.query<{ id: number }>('INSERT INTO application_groups (name) VALUES ($1) RETURNING id', ['my-group'])
    await pool.query('UPDATE monitored_applications SET application_group_id = $1 WHERE id = $2', [group.id, appId])
    await pool.query('INSERT INTO dev_team_application_groups (dev_team_id, application_group_id) VALUES ($1, $2)', [
      teamId,
      group.id,
    ])

    const dev = makeUser('D666666')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')

    expect(await canApproveDeployment(dev, appId)).toBe(true)
  })

  it('denies user with no team membership', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    expect(await canApproveDeployment(makeUser(), appId)).toBe(false)
  })

  it('denies after team role is soft-deleted', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D777777')
    const assignment = await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')
    expect(await canApproveDeployment(dev, appId)).toBe(true)

    await removeTeamRole(defined(assignment).id, 'admin')
    expect(await canApproveDeployment(dev, appId)).toBe(false)
  })

  it('allows if member of any one managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const team1 = await seedDevTeam(pool, 'team-1', 'Team 1', sectionId)
    const team2 = await seedDevTeam(pool, 'team-2', 'Team 2', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    // Both teams manage the app
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      team1,
      appId,
    ])
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      team2,
      appId,
    ])

    // User is only in team2
    const dev = makeUser('D888888')
    await assignTeamRole(dev.navIdent, team2, 'utvikler', 'admin')

    expect(await canApproveDeployment(dev, appId)).toBe(true)
  })

  it('denies when app linkage is soft-deleted', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D999999')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')
    expect(await canApproveDeployment(dev, appId)).toBe(true)

    // Soft-delete the linkage
    await pool.query(
      "UPDATE dev_team_applications SET deleted_at = NOW(), deleted_by = 'admin' WHERE dev_team_id = $1 AND monitored_app_id = $2",
      [teamId, appId],
    )
    expect(await canApproveDeployment(dev, appId)).toBe(false)
  })

  it('denies when dev team is deactivated', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D101010')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')
    expect(await canApproveDeployment(dev, appId)).toBe(true)

    // Deactivate the team
    await pool.query('UPDATE dev_teams SET is_active = false WHERE id = $1', [teamId])
    expect(await canApproveDeployment(dev, appId)).toBe(false)
  })
})

// ─── Deviation authorization ─────────────────────────────────────────────────

describe('canDeviateDeployment', () => {
  it('allows admin', async () => {
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    expect(await canDeviateDeployment(makeAdmin(), appId)).toBe(true)
  })

  it('allows produktleder in managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const pl = makeUser('P111111')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')

    expect(await canDeviateDeployment(pl, appId)).toBe(true)
  })

  it('allows tech_lead in managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const tl = makeUser('T111111')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')

    expect(await canDeviateDeployment(tl, appId)).toBe(true)
  })

  it('denies utvikler in managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D111111')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')

    expect(await canDeviateDeployment(dev, appId)).toBe(false)
  })
})

// ─── Team administration ─────────────────────────────────────────────────────

describe('canAdministerTeam', () => {
  it('allows admin', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await canAdministerTeam(makeAdmin(), teamId)).toBe(true)
  })

  it('allows produktleder', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const pl = makeUser('P333333')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')
    expect(await canAdministerTeam(pl, teamId)).toBe(true)
  })

  it('allows tech_lead', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const tl = makeUser('T333333')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')
    expect(await canAdministerTeam(tl, teamId)).toBe(true)
  })

  it('denies utvikler', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const dev = makeUser('D333333')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')
    expect(await canAdministerTeam(dev, teamId)).toBe(false)
  })

  it('denies user with no roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await canAdministerTeam(makeUser(), teamId)).toBe(false)
  })
})

// ─── Team membership ─────────────────────────────────────────────────────────

describe('isTeamMember', () => {
  it('returns true for member with active role', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    await assignTeamRole('M111111', teamId, 'utvikler', 'admin')
    expect(await isTeamMember('M111111', teamId)).toBe(true)
  })

  it('returns false after soft-delete', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const assignment = await assignTeamRole('M222222', teamId, 'utvikler', 'admin')
    await removeTeamRole(defined(assignment).id, 'admin')
    expect(await isTeamMember('M222222', teamId)).toBe(false)
  })

  it('returns false for non-member', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await isTeamMember('X999999', teamId)).toBe(false)
  })
})

// ─── CRUD operations ─────────────────────────────────────────────────────────

describe('role assignment CRUD', () => {
  it('assigns and retrieves section roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const result = await assignSectionRole('A111111', sectionId, 'teknologileder', 'admin')

    expect(result).not.toBeNull()
    expect(result?.nav_ident).toBe('A111111')
    expect(result?.role).toBe('teknologileder')

    const roles = await getUserRoles('A111111')
    expect(roles.sectionRoles).toHaveLength(1)
    expect(roles.sectionRoles[0].role).toBe('teknologileder')
  })

  it('assigns and retrieves team roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const result = await assignTeamRole('B222222', teamId, 'produktleder', 'admin')

    expect(result).not.toBeNull()
    expect(result?.role).toBe('produktleder')

    const assignments = await getTeamRoleAssignments(teamId)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].nav_ident).toBe('B222222')
  })

  it('is idempotent — duplicate assignment returns null', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const first = await assignTeamRole('C333333', teamId, 'utvikler', 'admin')
    expect(first).not.toBeNull()

    const duplicate = await assignTeamRole('C333333', teamId, 'utvikler', 'admin')
    expect(duplicate).toBeNull()

    const assignments = await getTeamRoleAssignments(teamId)
    expect(assignments).toHaveLength(1)
  })

  it('allows re-assignment after soft-delete', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const first = await assignTeamRole('D444444', teamId, 'utvikler', 'admin')
    await removeTeamRole(defined(first).id, 'admin')

    const second = await assignTeamRole('D444444', teamId, 'utvikler', 'other-admin')
    expect(second).not.toBeNull()

    const assignments = await getTeamRoleAssignments(teamId)
    expect(assignments).toHaveLength(1)
    expect(assignments[0].assigned_by).toBe('other-admin')
  })

  it('soft-delete sets deleted_at and deleted_by', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const assignment = await assignTeamRole('E555555', teamId, 'utvikler', 'admin')

    const removed = await removeTeamRole(defined(assignment).id, 'remover-ident')
    expect(removed).toBe(true)

    // Verify the row still exists with deletion info
    const { rows } = await pool.query('SELECT deleted_at, deleted_by FROM dev_team_role_assignments WHERE id = $1', [
      defined(assignment).id,
    ])
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('remover-ident')
  })

  it('double soft-delete returns false', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const assignment = await assignTeamRole('F666666', teamId, 'utvikler', 'admin')

    expect(await removeTeamRole(defined(assignment).id, 'admin')).toBe(true)
    expect(await removeTeamRole(defined(assignment).id, 'admin')).toBe(false)
  })

  it('getMembersGithubUsernamesForDevTeamRoles returns GitHub usernames for active team members', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    await assignTeamRole('U111111', teamId, 'utvikler', 'admin')
    await assignTeamRole('U222222', teamId, 'produktleder', 'admin')

    // Create user mappings
    await pool.query(
      "INSERT INTO user_mappings (nav_ident, github_username, display_name) VALUES ('U111111', 'user1', 'User One'), ('U222222', 'user2', 'User Two')",
    )

    const usernames = await getMembersGithubUsernamesForDevTeamRoles([teamId])
    expect(usernames.sort()).toEqual(['user1', 'user2'])
  })

  it('getMembersGithubUsernamesForDevTeamRoles excludes soft-deleted roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    const assignment = await assignTeamRole('U333333', teamId, 'utvikler', 'admin')
    await pool.query(
      "INSERT INTO user_mappings (nav_ident, github_username, display_name) VALUES ('U333333', 'user3', 'User Three')",
    )

    await removeTeamRole(defined(assignment).id, 'admin')

    const usernames = await getMembersGithubUsernamesForDevTeamRoles([teamId])
    expect(usernames).toEqual([])
  })

  it('getMembersGithubUsernamesForDevTeamRoles excludes inactive teams', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    await assignTeamRole('U444444', teamId, 'utvikler', 'admin')
    await pool.query(
      "INSERT INTO user_mappings (nav_ident, github_username, display_name) VALUES ('U444444', 'user4', 'User Four')",
    )

    await pool.query('UPDATE dev_teams SET is_active = false WHERE id = $1', [teamId])

    const usernames = await getMembersGithubUsernamesForDevTeamRoles([teamId])
    expect(usernames).toEqual([])
  })

  it('getDevTeamsForGithubUsernamesByRole returns active teams for a GitHub username', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    await assignTeamRole('U555555', teamId, 'utvikler', 'admin')
    await pool.query(
      "INSERT INTO user_mappings (nav_ident, github_username, display_name) VALUES ('U555555', 'user5', 'User Five')",
    )

    const teams = await getDevTeamsForGithubUsernamesByRole(['user5'])
    expect(teams).toHaveLength(1)
    expect(teams[0].slug).toBe('team-a')
  })

  it('getDevTeamsForGithubUsernamesByRole is case-insensitive', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    await assignTeamRole('U666666', teamId, 'utvikler', 'admin')
    await pool.query(
      "INSERT INTO user_mappings (nav_ident, github_username, display_name) VALUES ('U666666', 'UserSix', 'User Six')",
    )

    const teams = await getDevTeamsForGithubUsernamesByRole(['usersix'])
    expect(teams).toHaveLength(1)
    expect(teams[0].slug).toBe('team-a')
  })

  it('getDevTeamsForGithubUsernamesByRole excludes soft-deleted roles and inactive teams', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const team1 = await seedDevTeam(pool, 'team-1', 'Team 1', sectionId)
    const team2 = await seedDevTeam(pool, 'team-2', 'Team 2', sectionId)

    const assignment1 = await assignTeamRole('U777777', team1, 'utvikler', 'admin')
    await assignTeamRole('U777777', team2, 'utvikler', 'admin')
    await pool.query(
      "INSERT INTO user_mappings (nav_ident, github_username, display_name) VALUES ('U777777', 'user7', 'User Seven')",
    )

    // Soft-delete role in team1
    await removeTeamRole(defined(assignment1).id, 'admin')
    // Deactivate team2
    await pool.query('UPDATE dev_teams SET is_active = false WHERE id = $1', [team2])

    const teams = await getDevTeamsForGithubUsernamesByRole(['user7'])
    expect(teams).toEqual([])
  })

  it('getDevTeamMembersWithRoles returns members with roles and display info', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)

    await assignTeamRole('G777777', teamId, 'produktleder', 'admin')
    await assignTeamRole('H888888', teamId, 'utvikler', 'admin')

    const members = await getDevTeamMembersWithRoles(teamId)
    expect(members).toHaveLength(2)
    // produktleder sorts before utvikler alphabetically
    expect(members[0].role).toBe('produktleder')
    expect(members[1].role).toBe('utvikler')
  })
})

// ─── canAccessTeamAdmin ──────────────────────────────────────────────────────

describe('canAccessTeamAdmin', () => {
  it('allows admin', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await canAccessTeamAdmin(makeAdmin(), teamId)).toBe(true)
  })

  it('allows produktleder in the team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const pl = makeUser('P444444')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')
    expect(await canAccessTeamAdmin(pl, teamId)).toBe(true)
  })

  it('allows tech_lead in the team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const tl = makeUser('T444444')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')
    expect(await canAccessTeamAdmin(tl, teamId)).toBe(true)
  })

  it('allows section leader in the team section', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const sl = makeUser('S444444')
    await assignSectionRole(sl.navIdent, sectionId, 'seksjonsleder', 'admin')
    expect(await canAccessTeamAdmin(sl, teamId)).toBe(true)
  })

  it('allows teknologileder in the team section', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const tl = makeUser('T444444')
    await assignSectionRole(tl.navIdent, sectionId, 'teknologileder', 'admin')
    expect(await canAccessTeamAdmin(tl, teamId)).toBe(true)
  })

  it('denies section leader from a different section', async () => {
    const section1 = await seedSection(pool, 'pensjon')
    const section2 = await seedSection(pool, 'arbeid')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', section1)
    const sl = makeUser('S555555')
    await assignSectionRole(sl.navIdent, section2, 'seksjonsleder', 'admin')
    expect(await canAccessTeamAdmin(sl, teamId)).toBe(false)
  })

  it('denies utvikler in the team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const dev = makeUser('D444444')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')
    expect(await canAccessTeamAdmin(dev, teamId)).toBe(false)
  })

  it('denies user with no roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    expect(await canAccessTeamAdmin(makeUser(), teamId)).toBe(false)
  })

  it('denies access to inactive team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const pl = makeUser('P666666')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')
    await pool.query('UPDATE dev_teams SET is_active = false WHERE id = $1', [teamId])
    expect(await canAccessTeamAdmin(pl, teamId)).toBe(false)
  })
})

// ─── getTeamRoleAssignmentById ───────────────────────────────────────────────

describe('getTeamRoleAssignmentById', () => {
  it('returns assignment when id and devTeamId match', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const assignment = await assignTeamRole('R111111', teamId, 'utvikler', 'admin')
    const result = await getTeamRoleAssignmentById(defined(assignment).id, teamId)
    expect(result).not.toBeNull()
    expect(defined(result).role).toBe('utvikler')
    expect(defined(result).nav_ident).toBe('R111111')
  })

  it('returns null for wrong devTeamId', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const team1 = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const team2 = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const assignment = await assignTeamRole('R222222', team1, 'utvikler', 'admin')
    const result = await getTeamRoleAssignmentById(defined(assignment).id, team2)
    expect(result).toBeNull()
  })

  it('returns null for soft-deleted assignment', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const assignment = await assignTeamRole('R333333', teamId, 'utvikler', 'admin')
    await removeTeamRole(defined(assignment).id, 'admin')
    const result = await getTeamRoleAssignmentById(defined(assignment).id, teamId)
    expect(result).toBeNull()
  })

  it('returns null for nonexistent id', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const result = await getTeamRoleAssignmentById(99999, teamId)
    expect(result).toBeNull()
  })
})

// ─── resolveTeamAdminCapabilities ────────────────────────────────────────────

describe('resolveTeamAdminCapabilities', () => {
  it('returns canAccess=true, canAdmin=true for admin', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const result = await resolveTeamAdminCapabilities(makeAdmin(), teamId)
    expect(result).toEqual({ canAccess: true, canAdmin: true })
  })

  it('returns canAccess=true, canAdmin=true for produktleder in the team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const pl = makeUser('P777777')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')
    const result = await resolveTeamAdminCapabilities(pl, teamId)
    expect(result).toEqual({ canAccess: true, canAdmin: true })
  })

  it('returns canAccess=true, canAdmin=true for tech_lead in the team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const tl = makeUser('T777777')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')
    const result = await resolveTeamAdminCapabilities(tl, teamId)
    expect(result).toEqual({ canAccess: true, canAdmin: true })
  })

  it('returns canAccess=true, canAdmin=false for section leader', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const sl = makeUser('S777777')
    await assignSectionRole(sl.navIdent, sectionId, 'seksjonsleder', 'admin')
    const result = await resolveTeamAdminCapabilities(sl, teamId)
    expect(result).toEqual({ canAccess: true, canAdmin: false })
  })

  it('returns canAccess=false, canAdmin=false for section leader in different section', async () => {
    const section1 = await seedSection(pool, 'pensjon')
    const section2 = await seedSection(pool, 'arbeid')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', section1)
    const sl = makeUser('S888888')
    await assignSectionRole(sl.navIdent, section2, 'seksjonsleder', 'admin')
    const result = await resolveTeamAdminCapabilities(sl, teamId)
    expect(result).toEqual({ canAccess: false, canAdmin: false })
  })

  it('returns canAccess=false, canAdmin=false for user with no roles', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const result = await resolveTeamAdminCapabilities(makeUser(), teamId)
    expect(result).toEqual({ canAccess: false, canAdmin: false })
  })

  it('returns canAccess=false, canAdmin=false for inactive team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const pl = makeUser('P888888')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')
    await pool.query('UPDATE dev_teams SET is_active = false WHERE id = $1', [teamId])
    const result = await resolveTeamAdminCapabilities(pl, teamId)
    expect(result).toEqual({ canAccess: false, canAdmin: false })
  })
})

// ─── Deployment capabilities (single-pass) ──────────────────────────────────

describe('resolveDeploymentCapabilities', () => {
  it('grants all capabilities to admin', async () => {
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    const result = await resolveDeploymentCapabilities(makeAdmin(), appId)
    expect(result).toEqual({
      canApprove: true,
      canDeviate: true,
      canLinkGoal: true,
      canNotify: true,
      canLookupLegacy: true,
    })
  })

  it('grants standard capabilities to utvikler in managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D444444')
    await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')

    const result = await resolveDeploymentCapabilities(dev, appId)
    expect(result).toEqual({
      canApprove: true,
      canDeviate: false,
      canLinkGoal: true,
      canNotify: true,
      canLookupLegacy: true,
    })
  })

  it('grants canDeviate to produktleder in managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const pl = makeUser('P222222')
    await assignTeamRole(pl.navIdent, teamId, 'produktleder', 'admin')

    const result = await resolveDeploymentCapabilities(pl, appId)
    expect(result).toEqual({
      canApprove: true,
      canDeviate: true,
      canLinkGoal: true,
      canNotify: true,
      canLookupLegacy: true,
    })
  })

  it('grants canDeviate to tech_lead in managing team', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const tl = makeUser('T222222')
    await assignTeamRole(tl.navIdent, teamId, 'tech_lead', 'admin')

    const result = await resolveDeploymentCapabilities(tl, appId)
    expect(result).toEqual({
      canApprove: true,
      canDeviate: true,
      canLinkGoal: true,
      canNotify: true,
      canLookupLegacy: true,
    })
  })

  it('denies all capabilities to user without managing team role', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })

    const result = await resolveDeploymentCapabilities(makeUser(), appId)
    expect(result).toEqual({
      canApprove: false,
      canDeviate: false,
      canLinkGoal: false,
      canNotify: false,
      canLookupLegacy: false,
    })
  })

  it('denies all capabilities when team role is soft-deleted', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-team', appName: 'myapp', environment: 'prod-gcp' })
    await pool.query('INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)', [
      teamId,
      appId,
    ])

    const dev = makeUser('D444444')
    const assignment = await assignTeamRole(dev.navIdent, teamId, 'utvikler', 'admin')

    // Verify access before removal
    expect((await resolveDeploymentCapabilities(dev, appId)).canApprove).toBe(true)

    await removeTeamRole(defined(assignment).id, 'admin')

    const result = await resolveDeploymentCapabilities(dev, appId)
    expect(result).toEqual({
      canApprove: false,
      canDeviate: false,
      canLinkGoal: false,
      canNotify: false,
      canLookupLegacy: false,
    })
  })
})
