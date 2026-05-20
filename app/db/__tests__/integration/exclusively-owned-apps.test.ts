/**
 * Integration test: getExclusivelyOwnedAppIds.
 *
 * Verifies that the function correctly identifies apps owned by exactly one
 * dev team across all three ownership paths (direct link, nais team slug,
 * application group).
 */
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getExclusivelyOwnedAppIds } from '../../dev-teams.server'
import { assignAppToGroup, seedApp, seedApplicationGroup, seedDevTeam, seedSection, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateAllTables(pool)
})

describe('getExclusivelyOwnedAppIds', () => {
  it('returns empty set for empty input', async () => {
    const result = await getExclusivelyOwnedAppIds(1, [])
    expect(result.size).toBe(0)
  })

  it('identifies app owned via direct link by one team as exclusive', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-x', appName: 'app1', environment: 'prod' })

    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      teamId,
      appId,
    ])

    const result = await getExclusivelyOwnedAppIds(teamId, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('identifies app owned via nais team slug by one team as exclusive', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamId = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'my-nais-team', appName: 'app2', environment: 'prod' })

    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      teamId,
      'my-nais-team',
    ])

    const result = await getExclusivelyOwnedAppIds(teamId, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('identifies app owned via application group by one team as exclusive', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamId = await seedDevTeam(pool, 'team-c', 'Team C', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-y', appName: 'app3', environment: 'prod' })
    const groupId = await seedApplicationGroup(pool, 'my-group')

    await assignAppToGroup(pool, appId, groupId)
    await pool.query(`INSERT INTO dev_team_application_groups (dev_team_id, application_group_id) VALUES ($1, $2)`, [
      teamId,
      groupId,
    ])

    const result = await getExclusivelyOwnedAppIds(teamId, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('excludes app claimed by two teams via different paths', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'shared-nais', appName: 'shared-app', environment: 'prod' })

    // Team A owns via direct link
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      teamA,
      appId,
    ])
    // Team B owns via nais team slug
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      teamB,
      'shared-nais',
    ])

    const result = await getExclusivelyOwnedAppIds(teamA, [appId])
    expect(result.has(appId)).toBe(false)
  })

  it('excludes app claimed by two teams via same path (both direct)', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-z', appName: 'app-shared', environment: 'prod' })

    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $3), ($2, $3)`, [
      teamA,
      teamB,
      appId,
    ])

    const result = await getExclusivelyOwnedAppIds(teamA, [appId])
    expect(result.has(appId)).toBe(false)
  })

  it('handles mixed exclusive and shared apps in one call', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const exclusiveApp = await seedApp(pool, { teamSlug: 'nais-a', appName: 'exclusive', environment: 'prod' })
    const sharedApp = await seedApp(pool, { teamSlug: 'nais-b', appName: 'shared', environment: 'prod' })

    // exclusiveApp owned only by teamA
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      teamA,
      exclusiveApp,
    ])
    // sharedApp owned by both teams
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $3), ($2, $3)`, [
      teamA,
      teamB,
      sharedApp,
    ])

    const result = await getExclusivelyOwnedAppIds(teamA, [exclusiveApp, sharedApp])
    expect(result.has(exclusiveApp)).toBe(true)
    expect(result.has(sharedApp)).toBe(false)
  })

  it('ignores soft-deleted direct links', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-x', appName: 'app1', environment: 'prod' })

    // Team A has active link
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      teamA,
      appId,
    ])
    // Team B has soft-deleted link
    await pool.query(
      `INSERT INTO dev_team_applications (dev_team_id, monitored_app_id, deleted_at) VALUES ($1, $2, NOW())`,
      [teamB, appId],
    )

    const result = await getExclusivelyOwnedAppIds(teamA, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('ignores inactive dev teams', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const activeTeam = await seedDevTeam(pool, 'active-team', 'Active', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-x', appName: 'app1', environment: 'prod' })

    // Active team owns via direct link
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      activeTeam,
      appId,
    ])
    // Create inactive team that also claims ownership via nais slug
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO dev_teams (section_id, slug, name, is_active) VALUES ($1, $2, $3, false) RETURNING id`,
      [sectionId, 'inactive-team', 'Inactive'],
    )
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      rows[0].id,
      'nais-x',
    ])

    const result = await getExclusivelyOwnedAppIds(activeTeam, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('ignores soft-deleted nais team links', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'my-slug', appName: 'app1', environment: 'prod' })

    // Team A active nais team link
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      teamA,
      'my-slug',
    ])
    // Team B soft-deleted nais team link
    await pool.query(
      `INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug, deleted_at) VALUES ($1, $2, NOW())`,
      [teamB, 'my-slug'],
    )

    const result = await getExclusivelyOwnedAppIds(teamA, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('ignores soft-deleted application group links', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-x', appName: 'app1', environment: 'prod' })
    const groupId = await seedApplicationGroup(pool, 'group-1')

    await assignAppToGroup(pool, appId, groupId)

    // Team A active group link
    await pool.query(`INSERT INTO dev_team_application_groups (dev_team_id, application_group_id) VALUES ($1, $2)`, [
      teamA,
      groupId,
    ])
    // Team B soft-deleted group link
    await pool.query(
      `INSERT INTO dev_team_application_groups (dev_team_id, application_group_id, deleted_at) VALUES ($1, $2, NOW())`,
      [teamB, groupId],
    )

    const result = await getExclusivelyOwnedAppIds(teamA, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('same team owning via multiple paths counts as one', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'my-nais', appName: 'app1', environment: 'prod' })

    // Same team owns via direct link AND nais team
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      teamId,
      appId,
    ])
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      teamId,
      'my-nais',
    ])

    const result = await getExclusivelyOwnedAppIds(teamId, [appId])
    expect(result.has(appId)).toBe(true)
  })

  it('returns empty set for apps not claimed by any team', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'orphan-team', appName: 'orphan-app', environment: 'prod' })

    const result = await getExclusivelyOwnedAppIds(teamId, [appId])
    expect(result.has(appId)).toBe(false)
  })

  it('excludes app exclusively owned by a different team', async () => {
    const sectionId = await seedSection(pool, 'sec', 'Sec')
    const teamA = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
    const teamB = await seedDevTeam(pool, 'team-b', 'Team B', sectionId)
    const appId = await seedApp(pool, { teamSlug: 'nais-x', appName: 'app1', environment: 'prod' })

    // Only Team B owns the app
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      teamB,
      appId,
    ])

    // Team A queries — should NOT get this app as exclusive
    const result = await getExclusivelyOwnedAppIds(teamA, [appId])
    expect(result.has(appId)).toBe(false)
  })
})
