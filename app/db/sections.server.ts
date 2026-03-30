import { pool } from './connection.server'

export interface Section {
  id: number
  slug: string
  name: string
  entra_group_admin: string | null
  entra_group_user: string | null
  is_active: boolean
  created_at: Date
}

export interface SectionWithTeams extends Section {
  team_slugs: string[]
}

async function getAllSections(): Promise<Section[]> {
  const result = await pool.query('SELECT * FROM sections WHERE is_active = true ORDER BY name')
  return result.rows
}

export async function getSectionBySlug(slug: string): Promise<Section | null> {
  const result = await pool.query('SELECT * FROM sections WHERE slug = $1', [slug])
  return result.rows[0] ?? null
}

async function getSectionById(id: number): Promise<Section | null> {
  const result = await pool.query('SELECT * FROM sections WHERE id = $1', [id])
  return result.rows[0] ?? null
}

async function getSectionWithTeams(id: number): Promise<SectionWithTeams | null> {
  const result = await pool.query(
    `SELECT s.*, COALESCE(array_agg(st.team_slug ORDER BY st.team_slug) FILTER (WHERE st.team_slug IS NOT NULL), '{}') as team_slugs
     FROM sections s
     LEFT JOIN section_teams st ON st.section_id = s.id
     WHERE s.id = $1
     GROUP BY s.id`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function getAllSectionsWithTeams(): Promise<SectionWithTeams[]> {
  const result = await pool.query(
    `SELECT s.*, COALESCE(array_agg(st.team_slug ORDER BY st.team_slug) FILTER (WHERE st.team_slug IS NOT NULL), '{}') as team_slugs
     FROM sections s
     LEFT JOIN section_teams st ON st.section_id = s.id
     WHERE s.is_active = true
     GROUP BY s.id
     ORDER BY s.name`,
  )
  return result.rows
}

/**
 * Find sections a user belongs to based on their Entra ID groups.
 * Returns sections where the user's groups match either admin or user group.
 */
export async function getSectionsForEntraGroups(
  groupIds: string[],
): Promise<Array<Section & { role: 'admin' | 'user' }>> {
  if (groupIds.length === 0) return []

  const result = await pool.query(
    `SELECT s.*,
       CASE
         WHEN s.entra_group_admin = ANY($1) THEN 'admin'
         ELSE 'user'
       END as role
     FROM sections s
     WHERE s.is_active = true
       AND (s.entra_group_admin = ANY($1) OR s.entra_group_user = ANY($1))
     ORDER BY s.name`,
    [groupIds],
  )
  return result.rows
}

/**
 * Get all team_slugs that belong to the given sections.
 */
export async function getTeamSlugsForSections(sectionIds: number[]): Promise<string[]> {
  if (sectionIds.length === 0) return []

  const result = await pool.query(
    'SELECT DISTINCT team_slug FROM section_teams WHERE section_id = ANY($1) ORDER BY team_slug',
    [sectionIds],
  )
  return result.rows.map((r) => r.team_slug)
}

export async function createSection(
  slug: string,
  name: string,
  entraGroupAdmin?: string,
  entraGroupUser?: string,
): Promise<Section> {
  const result = await pool.query(
    'INSERT INTO sections (slug, name, entra_group_admin, entra_group_user) VALUES ($1, $2, $3, $4) RETURNING *',
    [slug, name, entraGroupAdmin ?? null, entraGroupUser ?? null],
  )
  return result.rows[0]
}

export async function updateSection(
  id: number,
  data: { name?: string; entra_group_admin?: string | null; entra_group_user?: string | null; is_active?: boolean },
): Promise<Section | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.name !== undefined) {
    sets.push(`name = $${idx++}`)
    values.push(data.name)
  }
  if (data.entra_group_admin !== undefined) {
    sets.push(`entra_group_admin = $${idx++}`)
    values.push(data.entra_group_admin)
  }
  if (data.entra_group_user !== undefined) {
    sets.push(`entra_group_user = $${idx++}`)
    values.push(data.entra_group_user)
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`)
    values.push(data.is_active)
  }

  if (sets.length === 0) return getSectionById(id)

  values.push(id)
  const result = await pool.query(`UPDATE sections SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values)
  return result.rows[0] ?? null
}

export async function setSectionTeams(sectionId: number, teamSlugs: string[]): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM section_teams WHERE section_id = $1', [sectionId])
    for (const slug of teamSlugs) {
      await client.query('INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)', [sectionId, slug])
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
