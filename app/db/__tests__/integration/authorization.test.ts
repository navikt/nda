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
  getTeamRoleAssignments,
  getUserRoles,
  removeSectionRole,
  removeTeamRole,
} from '~/db/role-assignments.server'
import type { UserIdentity } from '~/lib/auth.server'
import {
  canAdministerTeam,
  canApproveDeployment,
  canAssignSectionRole,
  canAssignTeamRole,
  canDeviateDeployment,
  isTeamMember,
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

    await removeSectionRole(assignment!.id, 'admin')
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

    await removeTeamRole(assignment!.id, 'admin')
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
    await removeTeamRole(assignment!.id, 'admin')
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
    await removeTeamRole(first!.id, 'admin')

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

    const removed = await removeTeamRole(assignment!.id, 'remover-ident')
    expect(removed).toBe(true)

    // Verify the row still exists with deletion info
    const { rows } = await pool.query('SELECT deleted_at, deleted_by FROM dev_team_role_assignments WHERE id = $1', [
      assignment!.id,
    ])
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('remover-ident')
  })

  it('double soft-delete returns false', async () => {
    const sectionId = await seedSection(pool, 'pensjon')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const assignment = await assignTeamRole('F666666', teamId, 'utvikler', 'admin')

    expect(await removeTeamRole(assignment!.id, 'admin')).toBe(true)
    expect(await removeTeamRole(assignment!.id, 'admin')).toBe(false)
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

    await removeTeamRole(assignment!.id, 'admin')

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
    await removeTeamRole(assignment1!.id, 'admin')
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
