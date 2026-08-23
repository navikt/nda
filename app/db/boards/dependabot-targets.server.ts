import { pool } from '../connection.server'

interface DependabotTarget {
  boardId: number
  objectiveId: number
  keyResultId: number | null
  periodStart: Date
  periodEnd: Date
}

export async function setDependabotTarget(boardId: number, objectiveId?: number, keyResultId?: number): Promise<void> {
  if (!objectiveId && !keyResultId) {
    throw new Error('Må angi objectiveId eller keyResultId.')
  }
  if (objectiveId && keyResultId) {
    throw new Error('Kan ikke angi både objectiveId og keyResultId.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const boardLock = await client.query('SELECT 1 FROM boards WHERE id = $1 FOR UPDATE', [boardId])
    if (boardLock.rowCount === 0) throw new Error('Tavlen finnes ikke.')

    if (keyResultId) {
      const check = await client.query(
        `SELECT 1 FROM board_key_results bkr JOIN board_objectives bo ON bkr.objective_id = bo.id WHERE bkr.id = $1 AND bo.board_id = $2 AND bkr.is_active = true AND bo.is_active = true FOR UPDATE OF bkr, bo`,
        [keyResultId, boardId],
      )
      if (check.rowCount === 0) throw new Error('Nøkkelresultatet tilhører ikke denne tavlen eller er deaktivert.')
    } else if (objectiveId) {
      const check = await client.query(
        'SELECT 1 FROM board_objectives WHERE id = $1 AND board_id = $2 AND is_active = true FOR UPDATE',
        [objectiveId, boardId],
      )
      if (check.rowCount === 0) throw new Error('Målet tilhører ikke denne tavlen eller er deaktivert.')
    }

    await client.query(
      `UPDATE board_objectives SET dependabot_target = false WHERE board_id = $1 AND dependabot_target = true`,
      [boardId],
    )
    await client.query(
      `UPDATE board_key_results SET dependabot_target = false
       WHERE objective_id IN (SELECT id FROM board_objectives WHERE board_id = $1)
       AND dependabot_target = true`,
      [boardId],
    )

    if (keyResultId) {
      await client.query('UPDATE board_key_results SET dependabot_target = true WHERE id = $1', [keyResultId])
    } else if (objectiveId) {
      await client.query('UPDATE board_objectives SET dependabot_target = true WHERE id = $1', [objectiveId])
    }

    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function clearDependabotTarget(boardId: number): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const boardLock = await client.query('SELECT 1 FROM boards WHERE id = $1 FOR UPDATE', [boardId])
    if (boardLock.rowCount === 0) throw new Error('Tavlen finnes ikke.')
    await client.query(`UPDATE board_objectives SET dependabot_target = false WHERE board_id = $1`, [boardId])
    await client.query(
      `UPDATE board_key_results SET dependabot_target = false
       WHERE objective_id IN (SELECT id FROM board_objectives WHERE board_id = $1)`,
      [boardId],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function loadDependabotTargets(devTeamIds: number[], asOfDate: Date): Promise<DependabotTarget[]> {
  if (devTeamIds.length === 0) return []

  const result = await pool.query(
    `SELECT b.id AS board_id, bo.id AS objective_id, NULL::int AS key_result_id, b.period_start, b.period_end
     FROM boards b
     JOIN board_objectives bo ON bo.board_id = b.id
     WHERE b.dev_team_id = ANY($1) AND b.is_active = true AND bo.is_active = true
       AND bo.dependabot_target = true
       AND b.period_start <= $2::date AND b.period_end >= $2::date
     UNION ALL
     SELECT b.id AS board_id, bo.id AS objective_id, bkr.id AS key_result_id, b.period_start, b.period_end
     FROM boards b
     JOIN board_objectives bo ON bo.board_id = b.id
     JOIN board_key_results bkr ON bkr.objective_id = bo.id
     WHERE b.dev_team_id = ANY($1) AND b.is_active = true AND bo.is_active = true AND bkr.is_active = true
       AND bkr.dependabot_target = true
       AND b.period_start <= $2::date AND b.period_end >= $2::date`,
    [devTeamIds, asOfDate],
  )

  return result.rows.map(
    (r: {
      board_id: number
      objective_id: number
      key_result_id: number | null
      period_start: string
      period_end: string
    }) => ({
      boardId: r.board_id,
      objectiveId: r.objective_id,
      keyResultId: r.key_result_id,
      periodStart: new Date(r.period_start),
      periodEnd: new Date(r.period_end),
    }),
  )
}
