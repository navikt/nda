import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assignSectionRole, assignTeamRole } from '../../role-assignments.server'
import {
  deleteUser,
  deleteUserMapping,
  getAllUserMappings,
  getUserMapping,
  getUserMappingByNavIdent,
  upsertUser,
  upsertUserMapping,
} from '../../user-mappings.server'
import { seedDevTeam, seedSection, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

describe('upsertUser — GitHub-løs bruker', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('oppretter en bruker uten GitHub-konto', async () => {
    const user = await upsertUser({
      navIdent: 'Z990001',
      displayName: 'Stille Skog',
      navEmail: 'stille.skog@nav.no',
    })

    expect(user.nav_ident).toBe('Z990001')
    expect(user.display_name).toBe('Stille Skog')
    expect(user.github_username).toBeNull()
    expect(user.deleted_at).toBeNull()
  })

  it('gjenfinner brukeren via getUserMappingByNavIdent', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Stille Skog', navEmail: 'stille.skog@nav.no' })

    const found = await getUserMappingByNavIdent('Z990001')
    expect(found?.nav_ident).toBe('Z990001')
    expect(found?.github_username).toBeNull()
  })

  it('gjenfinner brukeren via getUserMapping med nav_ident', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Stille Skog', navEmail: 'stille.skog@nav.no' })

    const found = await getUserMapping('Z990001')
    expect(found?.nav_ident).toBe('Z990001')
    expect(found?.display_name).toBe('Stille Skog')
  })

  it('inkluderer GitHub-løs bruker i getAllUserMappings', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Stille Skog', navEmail: 'stille.skog@nav.no' })

    const all = await getAllUserMappings()
    expect(all.some((m) => m.nav_ident === 'Z990001')).toBe(true)
    expect(all.find((m) => m.nav_ident === 'Z990001')?.github_username).toBeNull()
  })

  it('er idempotent — oppdaterer eksisterende bruker ved konflikt', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Stille Skog', navEmail: 'stille.skog@nav.no' })
    const updated = await upsertUser({
      navIdent: 'Z990001',
      displayName: 'Modig Bjørk',
      navEmail: 'stille.skog@nav.no',
    })

    expect(updated.display_name).toBe('Modig Bjørk')
    const { rows } = await pool.query('SELECT count(*) FROM users WHERE nav_ident = $1', ['Z990001'])
    expect(parseInt(rows[0].count, 10)).toBe(1)
  })

  it('kaster feil hvis upsertUser kalles uten nav_ident', async () => {
    await expect(upsertUser({ navIdent: '', displayName: 'Rask Elv', navEmail: 'rask.elv@nav.no' })).rejects.toThrow(
      'nav_ident is required',
    )
  })

  it('kan knytte GitHub-konto til en GitHub-løs bruker i etterkant', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Stille Skog', navEmail: 'stille.skog@nav.no' })
    const linked = await upsertUserMapping({
      githubUsername: 'stille-skog',
      navIdent: 'Z990001',
      displayName: 'Stille Skog',
      navEmail: 'stille.skog@nav.no',
    })

    expect(linked.nav_ident).toBe('Z990001')
    expect(linked.github_username).toBe('stille-skog')
  })
})

describe('deleteUser — atomisk sletting med rollrevoking', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('soft-sletter bruker, GitHub-kontoer og roller i én transaksjon', async () => {
    const sectionId = await seedSection(pool, 'test-seksjon')
    const teamId = await seedDevTeam(pool, 'test-team', 'Test Team', sectionId)
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await upsertUserMapping({
      githubUsername: 'glad-fjord',
      navIdent: 'Z990001',
      displayName: 'Glad Fjord',
      navEmail: 'glad.fjord@nav.no',
    })
    await assignTeamRole('Z990001', teamId, 'produktleder', 'Z990002')
    await assignSectionRole('Z990001', sectionId, 'seksjonsleder', 'Z990002')

    await deleteUser('Z990001', 'Z990002')

    // Brukeren er soft-slettet
    const { rows: userRows } = await pool.query('SELECT deleted_at, deleted_by FROM users WHERE nav_ident = $1', [
      'Z990001',
    ])
    expect(userRows[0].deleted_at).not.toBeNull()
    expect(userRows[0].deleted_by).toBe('Z990002')

    // GitHub-konto er soft-slettet
    const { rows: ghRows } = await pool.query(
      'SELECT deleted_at FROM user_github_accounts WHERE github_username = $1',
      ['glad-fjord'],
    )
    expect(ghRows[0].deleted_at).not.toBeNull()

    // Team-roller er revokert
    const { rows: teamRoles } = await pool.query(
      'SELECT deleted_at FROM dev_team_role_assignments WHERE nav_ident = $1',
      ['Z990001'],
    )
    expect(teamRoles[0].deleted_at).not.toBeNull()

    // Seksjonsroller er revokert
    const { rows: sectionRoles } = await pool.query(
      'SELECT deleted_at FROM section_role_assignments WHERE nav_ident = $1',
      ['Z990001'],
    )
    expect(sectionRoles[0].deleted_at).not.toBeNull()
  })

  it('gjenfinner ikke slettet bruker via getUserMappingByNavIdent', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await deleteUser('Z990001', 'Z990002')

    expect(await getUserMappingByNavIdent('Z990001')).toBeNull()
  })

  it('reaktivering via upsertUser arver ikke revokerte roller', async () => {
    const sectionId = await seedSection(pool, 'test-seksjon-2')
    const teamId = await seedDevTeam(pool, 'test-team-2', 'Test Team 2', sectionId)
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await assignTeamRole('Z990001', teamId, 'produktleder', 'Z990002')

    await deleteUser('Z990001', 'Z990002')
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })

    // Rolle forblir soft-slettet etter reaktivering
    const { rows } = await pool.query('SELECT deleted_at FROM dev_team_role_assignments WHERE nav_ident = $1', [
      'Z990001',
    ])
    expect(rows[0].deleted_at).not.toBeNull()
  })

  it('deleteUser er idempotent for ikke-eksisterende bruker', async () => {
    await expect(deleteUser('Z990099', 'Z990002')).resolves.not.toThrow()
  })

  it('deleteUser via nav_ident sletter GitHub-konto men bevarer deleteUserMapping for avkoblet konto', async () => {
    // deleteUserMapping (GitHub-only) skal kun brukes for avkoblede deployers
    await upsertUserMapping({ githubUsername: 'unlinked-deployer' })

    await deleteUserMapping('unlinked-deployer', 'Z990002')

    const { rows } = await pool.query('SELECT deleted_at FROM user_github_accounts WHERE github_username = $1', [
      'unlinked-deployer',
    ])
    expect(rows[0].deleted_at).not.toBeNull()
  })
})

describe('getAllUserMappings — primærkonto soft-deleted, sekundær aktiv', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('viser bruker via aktiv ikke-primær konto når primærkontoen er soft-deleted', async () => {
    // First account added becomes primary; second call promotes itself to primary
    await upsertUser({ navIdent: 'Z990001', displayName: 'Rask Elv', navEmail: 'rask.elv@nav.no' })
    await upsertUserMapping({
      githubUsername: 'rask-elv-primary',
      navIdent: 'Z990001',
      displayName: 'Rask Elv',
      navEmail: 'rask.elv@nav.no',
    })
    // Second upsert promotes rask-elv-secondary to primary, demoting rask-elv-primary
    await upsertUserMapping({
      githubUsername: 'rask-elv-secondary',
      navIdent: 'Z990001',
      displayName: 'Rask Elv',
      navEmail: 'rask.elv@nav.no',
    })

    // Soft-delete the now-primary (rask-elv-secondary)
    await deleteUserMapping('rask-elv-secondary', 'Z990002')

    // User should still appear in the admin list via the still-active (non-primary) account
    const mappings = await getAllUserMappings()
    const user = mappings.find((m) => m.nav_ident === 'Z990001')
    expect(user).toBeDefined()
    expect(user?.github_username).toBe('rask-elv-primary')
    expect(user?.deleted_at).toBeNull()
  })

  it('getAllUserMappings og getUserMappingByNavIdent er konsistente etter restore av primærkonto', async () => {
    await upsertUser({ navIdent: 'Z990001', displayName: 'Modig Bjørk', navEmail: 'modig.bjork@nav.no' })
    await upsertUserMapping({
      githubUsername: 'modig-bjork-main',
      navIdent: 'Z990001',
      displayName: 'Modig Bjørk',
      navEmail: 'modig.bjork@nav.no',
    })
    // modig-bjork-alt becomes primary after second upsert
    await upsertUserMapping({
      githubUsername: 'modig-bjork-alt',
      navIdent: 'Z990001',
      displayName: 'Modig Bjørk',
      navEmail: 'modig.bjork@nav.no',
    })

    // Soft-delete primary (modig-bjork-alt), then restore it
    await deleteUserMapping('modig-bjork-alt', 'Z990002')
    await pool.query(
      `UPDATE user_github_accounts SET deleted_at = NULL, deleted_by = NULL, is_primary = TRUE, updated_at = NOW()
       WHERE github_username = 'modig-bjork-alt'`,
    )
    await pool.query(
      `UPDATE user_github_accounts SET is_primary = FALSE, updated_at = NOW()
       WHERE nav_ident = 'Z990001' AND github_username != 'modig-bjork-alt'`,
    )

    const mappings = await getAllUserMappings()
    const user = mappings.find((m) => m.nav_ident === 'Z990001')
    expect(user).toBeDefined()
    expect(user?.github_username).toBe('modig-bjork-alt')

    const byNavIdent = await getUserMappingByNavIdent('Z990001')
    expect(byNavIdent?.github_username).toBe('modig-bjork-alt')
  })
})

describe('assignTeamRole / assignSectionRole — TOCTOU-guard', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('tildeler ikke rolle til slettet bruker', async () => {
    const sectionId = await seedSection(pool, 'test-seksjon-3')
    const teamId = await seedDevTeam(pool, 'test-team-3', 'Test Team 3', sectionId)
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })
    await deleteUser('Z990001', 'Z990002')

    const teamResult = await assignTeamRole('Z990001', teamId, 'produktleder', 'Z990002')
    expect(teamResult).toBeNull()

    const sectionResult = await assignSectionRole('Z990001', sectionId, 'seksjonsleder', 'Z990002')
    expect(sectionResult).toBeNull()
  })

  it('tildeler rolle til aktiv bruker', async () => {
    const sectionId = await seedSection(pool, 'test-seksjon-4')
    const teamId = await seedDevTeam(pool, 'test-team-4', 'Test Team 4', sectionId)
    await upsertUser({ navIdent: 'Z990001', displayName: 'Glad Fjord', navEmail: 'glad.fjord@nav.no' })

    const teamResult = await assignTeamRole('Z990001', teamId, 'produktleder', 'Z990002')
    expect(teamResult?.nav_ident).toBe('Z990001')
    expect(teamResult?.role).toBe('produktleder')

    const sectionResult = await assignSectionRole('Z990001', sectionId, 'seksjonsleder', 'Z990002')
    expect(sectionResult?.nav_ident).toBe('Z990001')
  })
})
