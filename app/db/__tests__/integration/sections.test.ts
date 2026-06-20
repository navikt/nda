import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { seedSection, truncateAllTables } from './helpers'

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

describe('sections', () => {
  it('creates and retrieves a section by slug', async () => {
    await pool.query(
      "INSERT INTO sections (slug, name, entra_group_admin, entra_group_user) VALUES ('pensjon', 'Pensjon', 'group-admin', 'group-user')",
    )
    const { rows } = await pool.query("SELECT * FROM sections WHERE slug = 'pensjon'")
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Pensjon')
    expect(rows[0].entra_group_admin).toBe('group-admin')
    expect(rows[0].is_active).toBe(true)
  })

  it('enforces unique slug constraint', async () => {
    await seedSection(pool, 'unique-slug')
    await expect(seedSection(pool, 'unique-slug')).rejects.toThrow(/unique/)
  })

  it('links section_teams and retrieves them', async () => {
    const sectionId = await seedSection(pool, 'sec1')
    await pool.query('INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)', [sectionId, 'team-a'])
    await pool.query('INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)', [sectionId, 'team-b'])

    const { rows } = await pool.query(
      `SELECT s.*, COALESCE(array_agg(st.team_slug ORDER BY st.team_slug) FILTER (WHERE st.team_slug IS NOT NULL), '{}') as team_slugs
       FROM sections s LEFT JOIN section_teams st ON st.section_id = s.id
       WHERE s.id = $1 GROUP BY s.id`,
      [sectionId],
    )
    expect(rows[0].team_slugs).toEqual(['team-a', 'team-b'])
  })

  it('setSectionTeams replaces all team links', async () => {
    const sectionId = await seedSection(pool, 'sec-replace')
    await pool.query('INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)', [sectionId, 'old-team'])

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM section_teams WHERE section_id = $1', [sectionId])
      await client.query('INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)', [sectionId, 'new-a'])
      await client.query('INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)', [sectionId, 'new-b'])
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const { rows } = await pool.query('SELECT team_slug FROM section_teams WHERE section_id = $1 ORDER BY team_slug', [
      sectionId,
    ])
    expect(rows.map((r) => r.team_slug)).toEqual(['new-a', 'new-b'])
  })

  it('getSectionsForEntraGroups matches admin and user groups', async () => {
    await pool.query(
      "INSERT INTO sections (slug, name, entra_group_admin, entra_group_user) VALUES ('s1', 'Section 1', 'admin-g1', 'user-g1')",
    )
    await pool.query(
      "INSERT INTO sections (slug, name, entra_group_admin, entra_group_user) VALUES ('s2', 'Section 2', 'admin-g2', 'user-g2')",
    )

    const { rows: adminRows } = await pool.query(
      `SELECT s.*, CASE WHEN s.entra_group_admin = ANY($1) THEN 'admin' ELSE 'user' END as role
       FROM sections s WHERE s.is_active = true AND (s.entra_group_admin = ANY($1) OR s.entra_group_user = ANY($1))`,
      [['admin-g1']],
    )
    expect(adminRows).toHaveLength(1)
    expect(adminRows[0].role).toBe('admin')

    const { rows: userRows } = await pool.query(
      `SELECT s.*, CASE WHEN s.entra_group_admin = ANY($1) THEN 'admin' ELSE 'user' END as role
       FROM sections s WHERE s.is_active = true AND (s.entra_group_admin = ANY($1) OR s.entra_group_user = ANY($1))`,
      [['user-g2']],
    )
    expect(userRows).toHaveLength(1)
    expect(userRows[0].role).toBe('user')
  })

  it('soft-deletes by setting is_active = false', async () => {
    const id = await seedSection(pool, 'to-deactivate')
    await pool.query('UPDATE sections SET is_active = false WHERE id = $1', [id])
    const { rows } = await pool.query('SELECT * FROM sections WHERE is_active = true')
    expect(rows.find((r) => r.slug === 'to-deactivate')).toBeUndefined()
  })
})
