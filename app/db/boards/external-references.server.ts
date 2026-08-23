import type { ExternalReference } from '../boards.server'
import { pool } from '../connection.server'

export async function externalReferenceBelongsToBoard(referenceId: number, boardId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM external_references er
     LEFT JOIN board_objectives bo_obj ON bo_obj.id = er.objective_id
     LEFT JOIN board_key_results bkr ON bkr.id = er.key_result_id
     LEFT JOIN board_objectives bo_kr ON bo_kr.id = bkr.objective_id
     WHERE er.id = $1
       AND (bo_obj.board_id = $2 OR bo_kr.board_id = $2)`,
    [referenceId, boardId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function addExternalReference(data: {
  ref_type: ExternalReference['ref_type']
  url: string
  title?: string
  objective_id?: number
  key_result_id?: number
}): Promise<ExternalReference> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (data.objective_id) {
      const obj = await client.query('SELECT is_active FROM board_objectives WHERE id = $1 FOR UPDATE', [
        data.objective_id,
      ])
      if (!obj.rows[0]) {
        throw new Error('Målet finnes ikke.')
      }
      if (!obj.rows[0].is_active) {
        throw new Error('Kan ikke legge til ekstern lenke på et deaktivert mål.')
      }
    }
    if (data.key_result_id) {
      const kr = await client.query(
        `SELECT bkr.is_active AS kr_active, bo.is_active AS obj_active
         FROM board_key_results bkr
         JOIN board_objectives bo ON bo.id = bkr.objective_id
         WHERE bkr.id = $1
         FOR UPDATE OF bkr, bo`,
        [data.key_result_id],
      )
      if (!kr.rows[0]) {
        throw new Error('Nøkkelresultatet finnes ikke.')
      }
      if (!kr.rows[0].kr_active) {
        throw new Error('Kan ikke legge til ekstern lenke på et deaktivert nøkkelresultat.')
      }
      if (!kr.rows[0].obj_active) {
        throw new Error('Kan ikke legge til ekstern lenke på et nøkkelresultat under et deaktivert mål.')
      }
    }
    const result = await client.query(
      `INSERT INTO external_references (ref_type, url, title, objective_id, key_result_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.ref_type, data.url, data.title ?? null, data.objective_id ?? null, data.key_result_id ?? null],
    )
    await client.query('COMMIT')
    return result.rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function deleteExternalReference(id: number, deletedBy: string): Promise<void> {
  const result = await pool.query(
    `UPDATE external_references er
     SET deleted_at = NOW(), deleted_by = $2
     WHERE er.id = $1
       AND er.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM board_objectives bo
         WHERE bo.id = er.objective_id AND bo.is_active = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM board_key_results bkr
         WHERE bkr.id = er.key_result_id AND bkr.is_active = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM board_key_results bkr
         JOIN board_objectives bo ON bo.id = bkr.objective_id
         WHERE bkr.id = er.key_result_id AND bo.is_active = false
       )
     RETURNING id`,
    [id, deletedBy],
  )
  if ((result.rowCount ?? 0) > 0) return

  const { rows } = await pool.query<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM external_references WHERE id = $1',
    [id],
  )
  if (rows.length === 0) return
  if (rows[0].deleted_at !== null) return
  throw new Error('Kan ikke slette ekstern lenke fra et deaktivert mål eller nøkkelresultat.')
}
