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
  created_at: string
}

export interface BoardKeyResult {
  id: number
  objective_id: number
  title: string
  description: string | null
  sort_order: number
  keywords: string[]
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

export async function getBoardsByDevTeam(devTeamId: number): Promise<Board[]> {
  const result = await pool.query('SELECT * FROM boards WHERE dev_team_id = $1 ORDER BY period_start DESC', [devTeamId])
  return result.rows
}

/** Lightweight board list with objectives and key results (titles/IDs only) for goal linking UI. */
export async function getBoardsWithGoalsForDevTeam(devTeamId: number): Promise<
  Array<{
    id: number
    title: string
    period_label: string
    objectives: Array<{ id: number; title: string; key_results: Array<{ id: number; title: string }> }>
  }>
> {
  const boards = await pool.query(
    `SELECT id, title, period_label FROM boards WHERE dev_team_id = $1 AND is_active = true ORDER BY period_start DESC`,
    [devTeamId],
  )

  const result = []
  for (const board of boards.rows) {
    const objectives = await pool.query(
      `SELECT bo.id, bo.title FROM board_objectives bo WHERE bo.board_id = $1 ORDER BY bo.sort_order, bo.id`,
      [board.id],
    )
    const objectivesWithKr = []
    for (const obj of objectives.rows) {
      const keyResults = await pool.query(
        `SELECT id, title FROM board_key_results WHERE objective_id = $1 ORDER BY sort_order, id`,
        [obj.id],
      )
      objectivesWithKr.push({ ...obj, key_results: keyResults.rows })
    }
    result.push({ ...board, objectives: objectivesWithKr })
  }
  return result
}

async function getBoardById(id: number): Promise<Board | null> {
  const result = await pool.query('SELECT * FROM boards WHERE id = $1', [id])
  return result.rows[0] ?? null
}

export async function getBoardWithObjectives(boardId: number): Promise<BoardWithObjectives | null> {
  const board = await getBoardById(boardId)
  if (!board) return null

  const objectivesResult = await pool.query(
    'SELECT * FROM board_objectives WHERE board_id = $1 ORDER BY sort_order, id',
    [boardId],
  )

  const objectives: ObjectiveWithKeyResults[] = []
  for (const obj of objectivesResult.rows) {
    const krResult = await pool.query(
      'SELECT * FROM board_key_results WHERE objective_id = $1 ORDER BY sort_order, id',
      [obj.id],
    )

    const objRefsResult = await pool.query('SELECT * FROM external_references WHERE objective_id = $1 ORDER BY id', [
      obj.id,
    ])

    const keyResults: BoardKeyResultWithRefs[] = []
    for (const kr of krResult.rows) {
      const krRefsResult = await pool.query('SELECT * FROM external_references WHERE key_result_id = $1 ORDER BY id', [
        kr.id,
      ])
      keyResults.push({ ...kr, external_references: krRefsResult.rows })
    }

    objectives.push({ ...obj, key_results: keyResults, external_references: objRefsResult.rows })
  }

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
    `UPDATE board_objectives SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  return result.rows[0] ?? null
}

export async function deleteObjective(id: number): Promise<void> {
  await pool.query('DELETE FROM board_objectives WHERE id = $1', [id])
}

// --- Key Result queries ---

export async function createKeyResult(
  objectiveId: number,
  title: string,
  description?: string,
): Promise<BoardKeyResult> {
  const maxOrder = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM board_key_results WHERE objective_id = $1',
    [objectiveId],
  )
  const result = await pool.query(
    'INSERT INTO board_key_results (objective_id, title, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
    [objectiveId, title, description ?? null, maxOrder.rows[0].next_order],
  )
  return result.rows[0]
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
    `UPDATE board_key_results SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  return result.rows[0] ?? null
}

export async function deleteKeyResult(id: number): Promise<void> {
  await pool.query('DELETE FROM board_key_results WHERE id = $1', [id])
}

// --- Keyword queries ---

export async function updateObjectiveKeywords(id: number, keywords: string[]): Promise<void> {
  await pool.query('UPDATE board_objectives SET keywords = $1 WHERE id = $2', [keywords, id])
}

export async function updateKeyResultKeywords(id: number, keywords: string[]): Promise<void> {
  await pool.query('UPDATE board_key_results SET keywords = $1 WHERE id = $2', [keywords, id])
}

// --- External Reference queries ---

export async function addExternalReference(data: {
  ref_type: ExternalReference['ref_type']
  url: string
  title?: string
  objective_id?: number
  key_result_id?: number
}): Promise<ExternalReference> {
  const result = await pool.query(
    `INSERT INTO external_references (ref_type, url, title, objective_id, key_result_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.ref_type, data.url, data.title ?? null, data.objective_id ?? null, data.key_result_id ?? null],
  )
  return result.rows[0]
}

export async function deleteExternalReference(id: number): Promise<void> {
  await pool.query('DELETE FROM external_references WHERE id = $1', [id])
}
