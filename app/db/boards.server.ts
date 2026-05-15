import { pool } from './connection.server'

export interface Board {
  id: number
  dev_team_id: number
  title: string
  period_type: 'tertiary' | 'quarterly'
  period_start: string
  period_end: string
  period_label: string
  is_active: boolean
  created_at: string
  created_by: string | null
}

export interface BoardObjective {
  id: number
  board_id: number
  title: string
  description: string | null
  sort_order: number
  keywords: string[]
  dependabot_target: boolean
  is_active: boolean
  created_at: string
}

export interface BoardKeyResult {
  id: number
  objective_id: number
  title: string
  description: string | null
  sort_order: number
  keywords: string[]
  dependabot_target: boolean
  is_active: boolean
  created_at: string
}

export interface ExternalReference {
  id: number
  ref_type: 'jira' | 'slack' | 'confluence' | 'github_issue' | 'other'
  url: string
  title: string | null
  objective_id: number | null
  key_result_id: number | null
  created_at: string
}

export interface ObjectiveWithKeyResults extends BoardObjective {
  key_results: BoardKeyResultWithRefs[]
  external_references: ExternalReference[]
}

export interface BoardKeyResultWithRefs extends BoardKeyResult {
  external_references: ExternalReference[]
}

interface BoardWithObjectives extends Board {
  objectives: ObjectiveWithKeyResults[]
}

// --- Board queries ---

export async function getBoardDevTeamId(boardId: number): Promise<number | null> {
  const result = await pool.query('SELECT dev_team_id FROM boards WHERE id = $1', [boardId])
  return result.rows[0]?.dev_team_id ?? null
}

export async function objectiveBelongsToBoard(objectiveId: number, boardId: number): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM board_objectives WHERE id = $1 AND board_id = $2', [
    objectiveId,
    boardId,
  ])
  return (result.rowCount ?? 0) > 0
}

export async function keyResultBelongsToBoard(keyResultId: number, boardId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM board_key_results bkr
     JOIN board_objectives bo ON bo.id = bkr.objective_id
     WHERE bkr.id = $1 AND bo.board_id = $2`,
    [keyResultId, boardId],
  )
  return (result.rowCount ?? 0) > 0
}

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

export async function getBoardsByDevTeam(devTeamId: number): Promise<Board[]> {
  const result = await pool.query('SELECT * FROM boards WHERE dev_team_id = $1 ORDER BY period_start DESC', [devTeamId])
  return result.rows
}

/**
 * Lightweight board list with objectives and key results (titles/IDs only)
 * for goal linking UI.
 *
 * Implementation: 3 queries total (boards, objectives across all boards, key
 * results across all objectives) regardless of hierarchy size, so this scales
 * with team size rather than O(boards × objectives).
 */
export async function getBoardsWithGoalsForDevTeam(
  devTeamId: number,
  asOfDate?: string,
): Promise<
  Array<{
    id: number
    period_label: string
    period_start: string
    period_end: string
    objectives: Array<{ id: number; title: string; key_results: Array<{ id: number; title: string }> }>
  }>
> {
  const dateFilter = asOfDate ? ' AND period_start <= $2 AND period_end >= $2' : ''
  const params: unknown[] = [devTeamId]
  if (asOfDate) params.push(asOfDate)

  const boardsResult = await pool.query(
    `SELECT id, period_label, period_start, period_end FROM boards WHERE dev_team_id = $1 AND is_active = true${dateFilter} ORDER BY period_start DESC`,
    params,
  )
  const boardIds = boardsResult.rows.map((b) => b.id as number)
  if (boardIds.length === 0) return []

  const objectivesResult = await pool.query(
    `SELECT id, board_id, title
     FROM board_objectives
     WHERE board_id = ANY($1::int[]) AND is_active = true
     ORDER BY sort_order, id`,
    [boardIds],
  )
  const objectiveIds = objectivesResult.rows.map((o) => o.id as number)

  const krResult =
    objectiveIds.length === 0
      ? { rows: [] as Array<{ id: number; objective_id: number; title: string }> }
      : await pool.query(
          `SELECT id, objective_id, title
           FROM board_key_results
           WHERE objective_id = ANY($1::int[]) AND is_active = true
           ORDER BY sort_order, id`,
          [objectiveIds],
        )

  const krByObjective = new Map<number, Array<{ id: number; title: string }>>()
  for (const kr of krResult.rows) {
    const list = krByObjective.get(kr.objective_id) ?? []
    list.push({ id: kr.id, title: kr.title })
    krByObjective.set(kr.objective_id, list)
  }

  const objectivesByBoard = new Map<
    number,
    Array<{ id: number; title: string; key_results: Array<{ id: number; title: string }> }>
  >()
  for (const obj of objectivesResult.rows) {
    const list = objectivesByBoard.get(obj.board_id) ?? []
    list.push({ id: obj.id, title: obj.title, key_results: krByObjective.get(obj.id) ?? [] })
    objectivesByBoard.set(obj.board_id, list)
  }

  return boardsResult.rows.map((board) => ({ ...board, objectives: objectivesByBoard.get(board.id) ?? [] }))
}

interface BoardKeywordsKeyResult {
  id: number
  title: string
  keywords: string[]
}

interface BoardKeywordsObjective {
  id: number
  title: string
  keywords: string[]
  key_results: BoardKeywordsKeyResult[]
}

interface BoardKeywordsBoard {
  id: number
  period_label: string
  team_name: string
  team_slug: string
  section_slug: string
  objectives: BoardKeywordsObjective[]
}

/**
 * Active boards (one or more) for a dev team, with full goal hierarchy and
 * keywords used by the auto-link pipeline. Used by the personalised Slack
 * home tab to render mål/nøkkelresultater/kodeord.
 *
 * Returns boards sorted by `period_start DESC`. Inactive objectives and key
 * results are excluded.
 *
 * Implementation: 3 queries total (boards, objectives across all boards, key
 * results across all objectives) regardless of hierarchy size, so this scales
 * with team size rather than O(boards × objectives).
 */
export async function getActiveBoardsWithKeywordsForDevTeam(devTeamId: number): Promise<BoardKeywordsBoard[]> {
  const boardsResult = await pool.query(
    `SELECT b.id, b.period_label, dt.name AS team_name, dt.slug AS team_slug, s.slug AS section_slug
     FROM boards b
     JOIN dev_teams dt ON dt.id = b.dev_team_id
     JOIN sections s ON s.id = dt.section_id
     WHERE b.dev_team_id = $1 AND b.is_active = true
     ORDER BY b.period_start DESC`,
    [devTeamId],
  )

  const boardIds = boardsResult.rows.map((b) => b.id as number)
  if (boardIds.length === 0) return []

  const objectivesResult = await pool.query(
    `SELECT id, board_id, title, COALESCE(keywords, '{}'::text[]) AS keywords
     FROM board_objectives
     WHERE board_id = ANY($1::int[]) AND is_active = true
     ORDER BY sort_order, id`,
    [boardIds],
  )
  const objectiveIds = objectivesResult.rows.map((o) => o.id as number)

  const krResult =
    objectiveIds.length === 0
      ? { rows: [] as Array<{ id: number; objective_id: number; title: string; keywords: string[] }> }
      : await pool.query(
          `SELECT id, objective_id, title, COALESCE(keywords, '{}'::text[]) AS keywords
           FROM board_key_results
           WHERE objective_id = ANY($1::int[]) AND is_active = true
           ORDER BY sort_order, id`,
          [objectiveIds],
        )

  const krByObjective = new Map<number, BoardKeywordsKeyResult[]>()
  for (const kr of krResult.rows) {
    const list = krByObjective.get(kr.objective_id) ?? []
    list.push({ id: kr.id, title: kr.title, keywords: kr.keywords })
    krByObjective.set(kr.objective_id, list)
  }

  const objectivesByBoard = new Map<number, BoardKeywordsObjective[]>()
  for (const obj of objectivesResult.rows) {
    const list = objectivesByBoard.get(obj.board_id) ?? []
    list.push({ id: obj.id, title: obj.title, keywords: obj.keywords, key_results: krByObjective.get(obj.id) ?? [] })
    objectivesByBoard.set(obj.board_id, list)
  }

  return boardsResult.rows.map((board) => ({ ...board, objectives: objectivesByBoard.get(board.id) ?? [] }))
}

async function getBoardById(id: number): Promise<Board | null> {
  const result = await pool.query('SELECT * FROM boards WHERE id = $1', [id])
  return result.rows[0] ?? null
}

/**
 * Full board with objectives, key results and external_references on both
 * objectives and key results.
 *
 * Implementation: 5 queries total (board, objectives, key results, objective
 * external_references, key-result external_references) regardless of
 * hierarchy size.
 */
export async function getBoardWithObjectives(boardId: number): Promise<BoardWithObjectives | null> {
  const board = await getBoardById(boardId)
  if (!board) return null

  const objectivesResult = await pool.query(
    'SELECT * FROM board_objectives WHERE board_id = $1 ORDER BY sort_order, id',
    [boardId],
  )
  const objectiveIds = objectivesResult.rows.map((o) => o.id as number)

  const krResult =
    objectiveIds.length === 0
      ? { rows: [] as BoardKeyResult[] }
      : await pool.query(
          'SELECT * FROM board_key_results WHERE objective_id = ANY($1::int[]) ORDER BY sort_order, id',
          [objectiveIds],
        )
  const keyResultIds = krResult.rows.map((kr) => kr.id as number)

  const objRefsResult =
    objectiveIds.length === 0
      ? { rows: [] as ExternalReference[] }
      : await pool.query(
          'SELECT * FROM external_references WHERE objective_id = ANY($1::int[]) AND deleted_at IS NULL ORDER BY id',
          [objectiveIds],
        )

  const krRefsResult =
    keyResultIds.length === 0
      ? { rows: [] as ExternalReference[] }
      : await pool.query(
          'SELECT * FROM external_references WHERE key_result_id = ANY($1::int[]) AND deleted_at IS NULL ORDER BY id',
          [keyResultIds],
        )

  const krRefsByKr = new Map<number, ExternalReference[]>()
  for (const ref of krRefsResult.rows) {
    if (ref.key_result_id == null) continue
    const list = krRefsByKr.get(ref.key_result_id) ?? []
    list.push(ref)
    krRefsByKr.set(ref.key_result_id, list)
  }

  const krsByObjective = new Map<number, BoardKeyResultWithRefs[]>()
  for (const kr of krResult.rows) {
    const list = krsByObjective.get(kr.objective_id) ?? []
    list.push({ ...kr, external_references: krRefsByKr.get(kr.id) ?? [] })
    krsByObjective.set(kr.objective_id, list)
  }

  const objRefsByObjective = new Map<number, ExternalReference[]>()
  for (const ref of objRefsResult.rows) {
    if (ref.objective_id == null) continue
    const list = objRefsByObjective.get(ref.objective_id) ?? []
    list.push(ref)
    objRefsByObjective.set(ref.objective_id, list)
  }

  const objectives: ObjectiveWithKeyResults[] = objectivesResult.rows.map((obj) => ({
    ...obj,
    key_results: krsByObjective.get(obj.id) ?? [],
    external_references: objRefsByObjective.get(obj.id) ?? [],
  }))

  return { ...board, objectives }
}

export async function createBoard(data: {
  dev_team_id: number
  title: string
  period_type: 'tertiary' | 'quarterly'
  period_start: string
  period_end: string
  period_label: string
  created_by?: string
}): Promise<Board> {
  const result = await pool.query(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      data.dev_team_id,
      data.title,
      data.period_type,
      data.period_start,
      data.period_end,
      data.period_label,
      data.created_by ?? null,
    ],
  )
  return result.rows[0]
}

async function _updateBoard(id: number, data: { title?: string; is_active?: boolean }): Promise<Board | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (data.title !== undefined) {
    sets.push(`title = $${idx++}`)
    values.push(data.title)
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`)
    values.push(data.is_active)
  }

  if (sets.length === 0) return getBoardById(id)

  values.push(id)
  const result = await pool.query(`UPDATE boards SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, values)
  return result.rows[0] ?? null
}

export async function updateBoardDates(id: number, periodStart: string, periodEnd: string): Promise<Board | null> {
  const result = await pool.query('UPDATE boards SET period_start = $1, period_end = $2 WHERE id = $3 RETURNING *', [
    periodStart,
    periodEnd,
    id,
  ])
  return result.rows[0] ?? null
}

// --- Objective queries ---

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

// --- Key Result queries ---

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

// --- Keyword queries ---

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

// --- External Reference queries ---

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
    await client.query('ROLLBACK')
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

  // The UPDATE matched zero rows. Re-read state to disambiguate:
  //   - row missing → no-op (idempotent)
  //   - row already soft-deleted (e.g. by a concurrent caller) → no-op (idempotent)
  //   - row still active in this follow-up read → treat it as blocked by a deactivated parent and throw
  const { rows } = await pool.query<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM external_references WHERE id = $1',
    [id],
  )
  if (rows.length === 0) return
  if (rows[0].deleted_at !== null) return
  throw new Error('Kan ikke slette ekstern lenke fra et deaktivert mål eller nøkkelresultat.')
}

// --- Dependabot target ---

interface DependabotTarget {
  boardId: number
  objectiveId: number
  keyResultId: number | null
  periodStart: Date
  periodEnd: Date
}

/**
 * Set a single objective or key result as the Dependabot target for its board.
 * Clears any other Dependabot targets on the same board (max one per board).
 */
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

    // Lock the board row to serialize concurrent setDependabotTarget calls
    const boardLock = await client.query('SELECT 1 FROM boards WHERE id = $1 FOR UPDATE', [boardId])
    if (boardLock.rowCount === 0) throw new Error('Tavlen finnes ikke.')

    // Validate that the objective/key result belongs to this board and is active
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

    // Clear all existing targets on this board
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

    // Set the new target
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

/**
 * Clear the Dependabot target for a board.
 */
export async function clearDependabotTarget(boardId: number): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Lock the board row to serialize with setDependabotTarget
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

/**
 * Load Dependabot targets from active boards for the given dev team IDs.
 * Returns targets where the board period covers the given date.
 */
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
