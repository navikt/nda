/**
 * Integration test: Dev team database queries.
 * Tests CRUD operations and application linking against a real PostgreSQL instance.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { seedApp, seedSection, truncateAllTables } from './helpers'

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

describe('dev_teams queries', () => {
  it('should create and retrieve a dev team', async () => {
    const sectionId = await seedSection(pool, 'test-section', 'Test Section')

    const { rows: created } = await pool.query(
      `INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3) RETURNING *`,
      [sectionId, 'team-alpha', 'Team Alpha'],
    )
    expect(created).toHaveLength(1)
    expect(created[0].slug).toBe('team-alpha')
    expect(created[0].name).toBe('Team Alpha')
    expect(created[0].is_active).toBe(true)

    // Retrieve with nais teams (empty)
    const { rows: teams } = await pool.query(
      `SELECT dt.*,
         COALESCE(array_agg(dn.nais_team_slug ORDER BY dn.nais_team_slug)
           FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs
       FROM dev_teams dt
       LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id
       WHERE dt.section_id = $1 AND dt.is_active = true
       GROUP BY dt.id
       ORDER BY dt.name`,
      [sectionId],
    )
    expect(teams).toHaveLength(1)
    expect(teams[0].nais_team_slugs).toEqual([])
  })

  it('should link and retrieve nais teams', async () => {
    const sectionId = await seedSection(pool, 'sec1')
    const {
      rows: [team],
    } = await pool.query(`INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3) RETURNING *`, [
      sectionId,
      'team-beta',
      'Team Beta',
    ])

    // Link nais teams
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2), ($1, $3)`, [
      team.id,
      'nais-team-a',
      'nais-team-b',
    ])

    const { rows } = await pool.query(
      `SELECT dt.*,
         COALESCE(array_agg(dn.nais_team_slug ORDER BY dn.nais_team_slug)
           FILTER (WHERE dn.nais_team_slug IS NOT NULL), '{}') as nais_team_slugs
       FROM dev_teams dt
       LEFT JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id
       WHERE dt.slug = $1
       GROUP BY dt.id`,
      ['team-beta'],
    )
    expect(rows[0].nais_team_slugs).toEqual(['nais-team-a', 'nais-team-b'])
  })

  it('should link applications directly to dev teams', async () => {
    const sectionId = await seedSection(pool, 'sec1')
    const {
      rows: [team],
    } = await pool.query(`INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3) RETURNING *`, [
      sectionId,
      'team-gamma',
      'Team Gamma',
    ])

    const app1Id = await seedApp(pool, { teamSlug: 'nais-1', appName: 'app-one', environment: 'prod' })
    const app2Id = await seedApp(pool, { teamSlug: 'nais-2', appName: 'app-two', environment: 'prod' })

    // Link app1 to the dev team
    await pool.query(`INSERT INTO dev_team_applications (dev_team_id, monitored_app_id) VALUES ($1, $2)`, [
      team.id,
      app1Id,
    ])

    // Query linked apps
    const { rows: linked } = await pool.query(
      `SELECT ma.id AS monitored_app_id, ma.team_slug, ma.environment_name, ma.app_name
       FROM dev_team_applications dta
       JOIN monitored_applications ma ON ma.id = dta.monitored_app_id
       WHERE dta.dev_team_id = $1
       ORDER BY ma.team_slug, ma.environment_name, ma.app_name`,
      [team.id],
    )
    expect(linked).toHaveLength(1)
    expect(linked[0].app_name).toBe('app-one')

    // Query all apps with link status
    const { rows: available } = await pool.query(
      `SELECT ma.id, ma.team_slug, ma.environment_name, ma.app_name,
              (dta.dev_team_id IS NOT NULL) AS is_linked
       FROM monitored_applications ma
       LEFT JOIN dev_team_applications dta ON dta.monitored_app_id = ma.id AND dta.dev_team_id = $1
       WHERE ma.is_active = true
       ORDER BY ma.team_slug, ma.environment_name, ma.app_name`,
      [team.id],
    )
    expect(available).toHaveLength(2)
    const linkedApp = available.find((a: { id: number }) => a.id === app1Id)
    const unlinkedApp = available.find((a: { id: number }) => a.id === app2Id)
    expect(linkedApp?.is_linked).toBe(true)
    expect(unlinkedApp?.is_linked).toBe(false)
  })

  it('should find dev team for a nais team', async () => {
    const sectionId = await seedSection(pool, 'sec1')
    const {
      rows: [team],
    } = await pool.query(`INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3) RETURNING *`, [
      sectionId,
      'team-delta',
      'Team Delta',
    ])
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      team.id,
      'nais-team-x',
    ])

    const { rows } = await pool.query(
      `SELECT dt.* FROM dev_teams dt
       JOIN dev_team_nais_teams dn ON dn.dev_team_id = dt.id
       WHERE dn.nais_team_slug = $1 AND dt.is_active = true`,
      ['nais-team-x'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].slug).toBe('team-delta')
  })

  it('should enforce unique slug constraint', async () => {
    const sectionId = await seedSection(pool, 'sec1')
    await pool.query(`INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3)`, [
      sectionId,
      'unique-team',
      'Team 1',
    ])

    await expect(
      pool.query(`INSERT INTO dev_teams (section_id, slug, name) VALUES ($1, $2, $3)`, [
        sectionId,
        'unique-team',
        'Team 2',
      ]),
    ).rejects.toThrow(/unique/)
  })
})
