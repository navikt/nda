import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { addExternalReference, deleteExternalReference, getBoardWithObjectives } from '../../boards.server'
import { seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

async function seedBoardWithObjectiveAndKr(pool: Pool) {
  const sectionId = await seedSection(pool, 'sec')
  const devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
  const { rows: boardRows } = await pool.query(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label, created_by)
     VALUES ($1, 'Sprint 1', 'tertiary', '2026-01-01', '2026-04-30', 'T1 2026', 'alice') RETURNING *`,
    [devTeamId],
  )
  const boardId = boardRows[0].id as number
  const { rows: objRows } = await pool.query(
    "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
    [boardId],
  )
  const objectiveId = objRows[0].id as number
  const { rows: krRows } = await pool.query(
    "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0) RETURNING *",
    [objectiveId],
  )
  const keyResultId = krRows[0].id as number
  return { boardId, objectiveId, keyResultId }
}

describe('external_references soft delete', () => {
  it('soft-deletes a reference and records deletedBy', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr(pool)
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })

    await deleteExternalReference(ref.id, 'A123456')

    const { rows } = await pool.query('SELECT id, deleted_at, deleted_by FROM external_references WHERE id = $1', [
      ref.id,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeInstanceOf(Date)
    expect(rows[0].deleted_by).toBe('A123456')
  })

  it('getBoardWithObjectives excludes soft-deleted references on objectives and key results', async () => {
    const { boardId, objectiveId, keyResultId } = await seedBoardWithObjectiveAndKr(pool)
    const objRef = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/obj',
      title: 'OBJ-1',
      objective_id: objectiveId,
    })
    const krRef = await addExternalReference({
      ref_type: 'github_issue',
      url: 'https://gh/kr',
      title: 'KR-1',
      key_result_id: keyResultId,
    })
    const keptRef = await addExternalReference({
      ref_type: 'slack',
      url: 'https://slack/kr',
      title: 'KR-keep',
      key_result_id: keyResultId,
    })

    await deleteExternalReference(objRef.id, 'A123456')
    await deleteExternalReference(krRef.id, 'A123456')

    const board = await getBoardWithObjectives(boardId)
    if (!board) throw new Error('expected board to exist')
    const obj = board.objectives[0]
    expect(obj.external_references).toHaveLength(0)
    expect(obj.key_results[0].external_references).toHaveLength(1)
    expect(obj.key_results[0].external_references[0].id).toBe(keptRef.id)
  })

  it('is idempotent: deleting an already soft-deleted reference is a no-op', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr(pool)
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })

    await deleteExternalReference(ref.id, 'A123456')
    const { rows: first } = await pool.query('SELECT deleted_at, deleted_by FROM external_references WHERE id = $1', [
      ref.id,
    ])
    const firstDeletedAt = first[0].deleted_at as Date

    await expect(deleteExternalReference(ref.id, 'B999999')).resolves.toBeUndefined()

    const { rows: second } = await pool.query('SELECT deleted_at, deleted_by FROM external_references WHERE id = $1', [
      ref.id,
    ])
    expect((second[0].deleted_at as Date).getTime()).toBe(firstDeletedAt.getTime())
    expect(second[0].deleted_by).toBe('A123456')
  })

  it('throws when soft-deleting under a deactivated objective', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr(pool)
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/1',
      title: 'JIRA-1',
      objective_id: objectiveId,
    })
    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [objectiveId])

    await expect(deleteExternalReference(ref.id, 'A123456')).rejects.toThrow(/deaktivert mål eller nøkkelresultat/)

    const { rows } = await pool.query('SELECT deleted_at FROM external_references WHERE id = $1', [ref.id])
    expect(rows[0].deleted_at).toBeNull()
  })

  it('throws when soft-deleting under a deactivated key result', async () => {
    const { keyResultId } = await seedBoardWithObjectiveAndKr(pool)
    const ref = await addExternalReference({
      ref_type: 'github_issue',
      url: 'https://gh/1',
      title: 'GH-1',
      key_result_id: keyResultId,
    })
    await pool.query('UPDATE board_key_results SET is_active = false WHERE id = $1', [keyResultId])

    await expect(deleteExternalReference(ref.id, 'A123456')).rejects.toThrow(/deaktivert mål eller nøkkelresultat/)

    const { rows } = await pool.query('SELECT deleted_at FROM external_references WHERE id = $1', [ref.id])
    expect(rows[0].deleted_at).toBeNull()
  })

  it('throws when soft-deleting a key-result reference whose parent objective is deactivated', async () => {
    const { objectiveId, keyResultId } = await seedBoardWithObjectiveAndKr(pool)
    const ref = await addExternalReference({
      ref_type: 'github_issue',
      url: 'https://gh/1',
      title: 'GH-1',
      key_result_id: keyResultId,
    })
    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [objectiveId])

    await expect(deleteExternalReference(ref.id, 'A123456')).rejects.toThrow(/deaktivert mål eller nøkkelresultat/)
  })

  it('concurrent double-delete is idempotent (one wins, the other is a no-op)', async () => {
    const { objectiveId } = await seedBoardWithObjectiveAndKr(pool)
    const ref = await addExternalReference({
      ref_type: 'jira',
      url: 'https://jira/race',
      title: 'JIRA-race',
      objective_id: objectiveId,
    })

    const results = await Promise.allSettled([
      deleteExternalReference(ref.id, 'A111111'),
      deleteExternalReference(ref.id, 'B222222'),
    ])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('fulfilled')

    const { rows } = await pool.query('SELECT deleted_at, deleted_by FROM external_references WHERE id = $1', [ref.id])
    expect(rows[0].deleted_at).toBeInstanceOf(Date)
    expect(['A111111', 'B222222']).toContain(rows[0].deleted_by)
  })
})
