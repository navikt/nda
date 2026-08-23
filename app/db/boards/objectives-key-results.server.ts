import type { BoardKeyResult, BoardObjective } from '../boards.server'
import { pool } from '../connection.server'

export async function createObjective(boardId: number, title: string, description?: string): Promise<BoardObjective> {
  const maxOrder = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM board_objectives WHERE board_id = $1',
    [boardId],
  )
  const result = await pool.query(
    'INSERT INTO board_objectives (board_id, title, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
    [boardId, title, description ?? null, maxOrder.rows[0].next_order],
  )
  return result.rows[0]
}

export async function updateObjective(
  id: number,
  data: { title?: string; description?: string },
): Promise<BoardObjective | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.title !== undefined) {
    sets.push(`title = $${idx++}`)
    values.push(data.title)
  }
  if (data.description !== undefined) {
    sets.push(`description = $${idx++}`)
    values.push(data.description)
  }

  if (sets.length === 0) return null

  values.push(id)
  const result = await pool.query(
    `UPDATE board_objectives SET ${sets.join(', ')} WHERE id = $${idx} AND is_active = true RETURNING *`,
    values,
  )
  if (result.rowCount === 0) throw new Error('Kan ikke oppdatere et deaktivert mål.')
  return result.rows[0] ?? null
}

export async function deactivateObjective(id: number): Promise<void> {
  await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [id])
}

export async function reactivateObjective(id: number): Promise<void> {
  await pool.query('UPDATE board_objectives SET is_active = true WHERE id = $1', [id])
}

export async function createKeyResult(
  objectiveId: number,
  title: string,
  description?: string,
): Promise<BoardKeyResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const obj = await client.query('SELECT is_active FROM board_objectives WHERE id = $1 FOR UPDATE', [objectiveId])
    if (!obj.rows[0]?.is_active) {
      throw new Error('Kan ikke legge til nøkkelresultat på et deaktivert mål.')
    }
    const maxOrder = await client.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM board_key_results WHERE objective_id = $1',
      [objectiveId],
    )
    const result = await client.query(
      'INSERT INTO board_key_results (objective_id, title, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [objectiveId, title, description ?? null, maxOrder.rows[0].next_order],
    )
    await client.query('COMMIT')
    return result.rows[0]
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function updateKeyResult(
  id: number,
  data: { title?: string; description?: string },
): Promise<BoardKeyResult | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.title !== undefined) {
    sets.push(`title = $${idx++}`)
    values.push(data.title)
  }
  if (data.description !== undefined) {
    sets.push(`description = $${idx++}`)
    values.push(data.description)
  }

  if (sets.length === 0) return null

  values.push(id)
  const result = await pool.query(
    `UPDATE board_key_results
     SET ${sets.join(', ')}
     WHERE id = $${idx}
       AND is_active = true
       AND EXISTS (
         SELECT 1 FROM board_objectives
         WHERE board_objectives.id = board_key_results.objective_id
           AND board_objectives.is_active = true
       )
     RETURNING *`,
    values,
  )
  if (result.rowCount === 0)
    throw new Error('Kan ikke oppdatere et deaktivert nøkkelresultat eller et nøkkelresultat under et deaktivert mål.')
  return result.rows[0] ?? null
}

export async function deactivateKeyResult(id: number): Promise<void> {
  await pool.query('UPDATE board_key_results SET is_active = false WHERE id = $1', [id])
}

export async function reactivateKeyResult(id: number): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const obj = await client.query(
      `SELECT bo.is_active
       FROM board_key_results bkr
       JOIN board_objectives bo ON bo.id = bkr.objective_id
       WHERE bkr.id = $1
       FOR UPDATE OF bo, bkr`,
      [id],
    )
    if (!obj.rows[0]) {
      throw new Error('Nøkkelresultatet finnes ikke.')
    }
    if (!obj.rows[0].is_active) {
      throw new Error('Kan ikke reaktivere et nøkkelresultat under et deaktivert mål.')
    }
    await client.query('UPDATE board_key_results SET is_active = true WHERE id = $1', [id])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function updateObjectiveKeywords(id: number, keywords: string[]): Promise<void> {
  const result = await pool.query('UPDATE board_objectives SET keywords = $1 WHERE id = $2 AND is_active = true', [
    keywords,
    id,
  ])
  if (result.rowCount === 0) throw new Error('Kan ikke oppdatere kode-ord på et deaktivert mål.')
}

export async function updateKeyResultKeywords(id: number, keywords: string[]): Promise<void> {
  const result = await pool.query(
    `UPDATE board_key_results
     SET keywords = $1
     WHERE id = $2
       AND is_active = true
       AND EXISTS (
         SELECT 1 FROM board_objectives
         WHERE board_objectives.id = board_key_results.objective_id
           AND board_objectives.is_active = true
       )`,
    [keywords, id],
  )
  if (result.rowCount === 0)
    throw new Error('Kan ikke oppdatere kode-ord på et deaktivert nøkkelresultat eller under et deaktivert mål.')
}
