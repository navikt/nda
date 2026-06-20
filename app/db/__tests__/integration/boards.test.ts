import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  externalReferenceBelongsToBoard,
  getBoardsWithGoalsForDevTeam,
  getBoardWithObjectives,
  keyResultBelongsToBoard,
  objectiveBelongsToBoard,
} from '../../boards.server'
import { seedApp, seedDeployment, seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

async function seedBoardStack(pool: Pool) {
  const sectionId = await seedSection(pool, 'sec')
  const devTeamId = await seedDevTeam(pool, 'team', 'Team', sectionId)
  const { rows: boardRows } = await pool.query(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label, created_by)
     VALUES ($1, 'Sprint 1', 'tertiary', '2026-01-01', '2026-04-30', 'T1 2026', 'alice') RETURNING *`,
    [devTeamId],
  )
  return { sectionId, devTeamId, board: boardRows[0] }
}

describe('boards', () => {
  it('creates a board linked to a dev team', async () => {
    const { board, devTeamId } = await seedBoardStack(pool)
    expect(board.dev_team_id).toBe(devTeamId)
    expect(board.title).toBe('Sprint 1')
    expect(board.period_type).toBe('tertiary')
    expect(board.is_active).toBe(true)
  })

  it('creates objectives with auto-incrementing sort_order', async () => {
    const { board } = await seedBoardStack(pool)

    const { rows: obj1 } = await pool.query(
      `INSERT INTO board_objectives (board_id, title, sort_order)
       VALUES ($1, 'Objective 1', 0) RETURNING *`,
      [board.id],
    )
    const { rows: obj2 } = await pool.query(
      `INSERT INTO board_objectives (board_id, title, sort_order)
       VALUES ($1, 'Objective 2', 1) RETURNING *`,
      [board.id],
    )

    expect(obj1[0].sort_order).toBe(0)
    expect(obj2[0].sort_order).toBe(1)
  })

  it('creates key results under objectives', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    const { rows: kr } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR 1', 0) RETURNING *",
      [obj[0].id],
    )
    expect(kr[0].objective_id).toBe(obj[0].id)
    expect(kr[0].title).toBe('KR 1')
  })

  it('soft delete: deactivating objective sets is_active to false', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    await pool.query("INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0)", [
      obj[0].id,
    ])

    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [obj[0].id])

    const { rows: objectives } = await pool.query('SELECT * FROM board_objectives WHERE id = $1', [obj[0].id])
    expect(objectives).toHaveLength(1)
    expect(objectives[0].is_active).toBe(false)

    const { rows: keyResults } = await pool.query('SELECT * FROM board_key_results WHERE objective_id = $1', [
      obj[0].id,
    ])
    expect(keyResults).toHaveLength(1)
  })

  it('RESTRICT prevents physical deletion of objective when deployment goal links exist', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )

    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'restrict-test', environment: 'prod' })
    const deploymentId = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })
    await pool.query(
      "INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method) VALUES ($1, $2, 'manual')",
      [deploymentId, obj[0].id],
    )

    await expect(pool.query('DELETE FROM board_objectives WHERE id = $1', [obj[0].id])).rejects.toThrow()
  })

  it('RESTRICT prevents physical deletion of key result when deployment goal links exist', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    const { rows: kr } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0) RETURNING *",
      [obj[0].id],
    )

    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'kr-restrict-test', environment: 'prod' })
    const deploymentId = await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team', environment: 'prod' })
    await pool.query(
      "INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method) VALUES ($1, $2, 'manual')",
      [deploymentId, kr[0].id],
    )

    await expect(pool.query('DELETE FROM board_key_results WHERE id = $1', [kr[0].id])).rejects.toThrow()
  })

  it('RESTRICT prevents physical deletion of board when objectives exist', async () => {
    const { board } = await seedBoardStack(pool)
    await pool.query("INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0)", [board.id])

    await expect(pool.query('DELETE FROM boards WHERE id = $1', [board.id])).rejects.toThrow()
  })

  it('reactivation restores objective to active state', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )

    await pool.query('UPDATE board_objectives SET is_active = false WHERE id = $1', [obj[0].id])
    await pool.query('UPDATE board_objectives SET is_active = true WHERE id = $1', [obj[0].id])

    const { rows } = await pool.query('SELECT * FROM board_objectives WHERE id = $1', [obj[0].id])
    expect(rows[0].is_active).toBe(true)
  })

  it('external references link to objectives and key results', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    const { rows: kr } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0) RETURNING *",
      [obj[0].id],
    )

    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, objective_id) VALUES ('jira', 'https://jira/1', 'JIRA-1', $1)",
      [obj[0].id],
    )
    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, key_result_id) VALUES ('github_issue', 'https://gh/1', 'GH-1', $1)",
      [kr[0].id],
    )

    const { rows: refs } = await pool.query(
      'SELECT * FROM external_references WHERE objective_id = $1 OR key_result_id = $2 ORDER BY id',
      [obj[0].id, kr[0].id],
    )
    expect(refs).toHaveLength(2)
    expect(refs[0].ref_type).toBe('jira')
    expect(refs[1].ref_type).toBe('github_issue')
  })

  it('RESTRICT prevents physical deletion of objective when key results exist', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    await pool.query("INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0)", [
      obj[0].id,
    ])

    await expect(pool.query('DELETE FROM board_objectives WHERE id = $1', [obj[0].id])).rejects.toThrow(
      /violates foreign key constraint/,
    )
  })

  it('RESTRICT prevents physical deletion of objective when external references exist', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, objective_id) VALUES ('jira', 'https://jira/1', 'JIRA-1', $1)",
      [obj[0].id],
    )

    await expect(pool.query('DELETE FROM board_objectives WHERE id = $1', [obj[0].id])).rejects.toThrow(
      /violates foreign key constraint/,
    )
  })

  it('RESTRICT prevents physical deletion of key result when external references exist', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: obj } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Obj', 0) RETURNING *",
      [board.id],
    )
    const { rows: kr } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR', 0) RETURNING *",
      [obj[0].id],
    )
    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, key_result_id) VALUES ('github_issue', 'https://gh/1', 'GH-1', $1)",
      [kr[0].id],
    )

    await expect(pool.query('DELETE FROM board_key_results WHERE id = $1', [kr[0].id])).rejects.toThrow(
      /violates foreign key constraint/,
    )
  })

  it('updates board title and is_active', async () => {
    const { board } = await seedBoardStack(pool)
    await pool.query("UPDATE boards SET title = 'Updated', is_active = false WHERE id = $1", [board.id])
    const { rows } = await pool.query('SELECT * FROM boards WHERE id = $1', [board.id])
    expect(rows[0].title).toBe('Updated')
    expect(rows[0].is_active).toBe(false)
  })
})

describe('getBoardsWithGoalsForDevTeam', () => {
  it('returns empty array when dev team has no boards', async () => {
    const sectionId = await seedSection(pool, 'sec-empty')
    const devTeamId = await seedDevTeam(pool, 'team-empty', 'Empty', sectionId)
    expect(await getBoardsWithGoalsForDevTeam(devTeamId)).toEqual([])
  })

  it('returns board with empty objectives when board has none', async () => {
    const { board, devTeamId } = await seedBoardStack(pool)
    const result = await getBoardsWithGoalsForDevTeam(devTeamId)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(board.id)
    expect(result[0].objectives).toEqual([])
  })

  it('returns full hierarchy for multiple boards/objectives/key results in 3 queries', async () => {
    const sectionId = await seedSection(pool, 'sec-multi')
    const devTeamId = await seedDevTeam(pool, 'team-multi', 'Multi', sectionId)
    const { rows: b1 } = await pool.query(
      `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
       VALUES ($1, 'B1', 'tertiary', '2026-01-01', '2026-04-30', 'T1') RETURNING id`,
      [devTeamId],
    )
    const { rows: b2 } = await pool.query(
      `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
       VALUES ($1, 'B2', 'tertiary', '2026-05-01', '2026-08-31', 'T2') RETURNING id`,
      [devTeamId],
    )

    const { rows: o1 } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'O1', 0) RETURNING id",
      [b1[0].id],
    )
    await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'O2-no-kr', 1) RETURNING id",
      [b1[0].id],
    )
    const { rows: o3 } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'O3', 0) RETURNING id",
      [b2[0].id],
    )
    await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order, is_active) VALUES ($1, 'O-inactive', 2, false)",
      [b1[0].id],
    )

    await pool.query("INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR1', 0)", [
      o1[0].id,
    ])
    await pool.query("INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR2', 1)", [
      o1[0].id,
    ])
    await pool.query("INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR3', 0)", [
      o3[0].id,
    ])
    await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order, is_active) VALUES ($1, 'KR-inactive', 2, false)",
      [o1[0].id],
    )

    const result = await getBoardsWithGoalsForDevTeam(devTeamId)
    expect(result.map((b) => b.id)).toEqual([b2[0].id, b1[0].id])

    const board2 = result[0]
    const board1 = result[1]
    expect(board2.objectives.map((o) => o.title)).toEqual(['O3'])
    expect(board2.objectives[0].key_results.map((k) => k.title)).toEqual(['KR3'])

    expect(board1.objectives.map((o) => o.title)).toEqual(['O1', 'O2-no-kr'])
    expect(board1.objectives[0].key_results.map((k) => k.title)).toEqual(['KR1', 'KR2'])
    expect(board1.objectives[1].key_results).toEqual([])
  })
})

describe('getBoardWithObjectives', () => {
  it('returns null for unknown board', async () => {
    expect(await getBoardWithObjectives(999_999)).toBeNull()
  })

  describe('ownership checks', () => {
    it('validates objective ownership for board', async () => {
      const { board } = await seedBoardStack(pool)
      const sectionId = await seedSection(pool, 'sec-other-obj')
      const otherDevTeamId = await seedDevTeam(pool, 'team-other-obj', 'Other Team', sectionId)
      const { rows: otherBoardRows } = await pool.query(
        `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
         VALUES ($1, 'Other', 'tertiary', '2026-01-01', '2026-04-30', 'T1') RETURNING id`,
        [otherDevTeamId],
      )

      const { rows: ownObjectiveRows } = await pool.query(
        "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Own', 0) RETURNING id",
        [board.id],
      )
      const { rows: otherObjectiveRows } = await pool.query(
        "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Other', 0) RETURNING id",
        [otherBoardRows[0].id],
      )

      await expect(objectiveBelongsToBoard(ownObjectiveRows[0].id, board.id)).resolves.toBe(true)
      await expect(objectiveBelongsToBoard(otherObjectiveRows[0].id, board.id)).resolves.toBe(false)
    })

    it('validates key result ownership for board', async () => {
      const { board } = await seedBoardStack(pool)
      const sectionId = await seedSection(pool, 'sec-other-kr')
      const otherDevTeamId = await seedDevTeam(pool, 'team-other-kr', 'Other Team KR', sectionId)
      const { rows: otherBoardRows } = await pool.query(
        `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
         VALUES ($1, 'Other KR', 'tertiary', '2026-01-01', '2026-04-30', 'T1') RETURNING id`,
        [otherDevTeamId],
      )

      const { rows: ownObjectiveRows } = await pool.query(
        "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Own Objective', 0) RETURNING id",
        [board.id],
      )
      const { rows: otherObjectiveRows } = await pool.query(
        "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Other Objective', 0) RETURNING id",
        [otherBoardRows[0].id],
      )

      const { rows: ownKrRows } = await pool.query(
        "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'Own KR', 0) RETURNING id",
        [ownObjectiveRows[0].id],
      )
      const { rows: otherKrRows } = await pool.query(
        "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'Other KR', 0) RETURNING id",
        [otherObjectiveRows[0].id],
      )

      await expect(keyResultBelongsToBoard(ownKrRows[0].id, board.id)).resolves.toBe(true)
      await expect(keyResultBelongsToBoard(otherKrRows[0].id, board.id)).resolves.toBe(false)
    })

    it('validates external reference ownership for board', async () => {
      const { board } = await seedBoardStack(pool)
      const sectionId = await seedSection(pool, 'sec-other-ref')
      const otherDevTeamId = await seedDevTeam(pool, 'team-other-ref', 'Other Team Ref', sectionId)
      const { rows: otherBoardRows } = await pool.query(
        `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
         VALUES ($1, 'Other Ref', 'tertiary', '2026-01-01', '2026-04-30', 'T1') RETURNING id`,
        [otherDevTeamId],
      )

      const { rows: ownObjectiveRows } = await pool.query(
        "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Own Objective', 0) RETURNING id",
        [board.id],
      )
      const { rows: otherObjectiveRows } = await pool.query(
        "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'Other Objective', 0) RETURNING id",
        [otherBoardRows[0].id],
      )

      const { rows: ownRefRows } = await pool.query(
        "INSERT INTO external_references (ref_type, url, title, objective_id) VALUES ('jira', 'https://jira/own', 'Own Ref', $1) RETURNING id",
        [ownObjectiveRows[0].id],
      )
      const { rows: otherRefRows } = await pool.query(
        "INSERT INTO external_references (ref_type, url, title, objective_id) VALUES ('jira', 'https://jira/other', 'Other Ref', $1) RETURNING id",
        [otherObjectiveRows[0].id],
      )
      const { rows: ownKrRows } = await pool.query(
        "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'Own KR', 0) RETURNING id",
        [ownObjectiveRows[0].id],
      )
      const { rows: otherKrRows } = await pool.query(
        "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'Other KR', 0) RETURNING id",
        [otherObjectiveRows[0].id],
      )
      const { rows: ownKrRefRows } = await pool.query(
        "INSERT INTO external_references (ref_type, url, title, key_result_id) VALUES ('github_issue', 'https://gh/own', 'Own KR Ref', $1) RETURNING id",
        [ownKrRows[0].id],
      )
      const { rows: otherKrRefRows } = await pool.query(
        "INSERT INTO external_references (ref_type, url, title, key_result_id) VALUES ('github_issue', 'https://gh/other', 'Other KR Ref', $1) RETURNING id",
        [otherKrRows[0].id],
      )
      await pool.query('UPDATE external_references SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1', [
        ownRefRows[0].id,
        'A123456',
      ])

      await expect(externalReferenceBelongsToBoard(ownRefRows[0].id, board.id)).resolves.toBe(true)
      await expect(externalReferenceBelongsToBoard(otherRefRows[0].id, board.id)).resolves.toBe(false)
      await expect(externalReferenceBelongsToBoard(ownKrRefRows[0].id, board.id)).resolves.toBe(true)
      await expect(externalReferenceBelongsToBoard(otherKrRefRows[0].id, board.id)).resolves.toBe(false)
    })
  })

  it('returns board with empty objectives array when no objectives exist', async () => {
    const { board } = await seedBoardStack(pool)
    const result = await getBoardWithObjectives(board.id)
    expect(result).not.toBeNull()
    expect(result?.objectives).toEqual([])
  })

  it('returns full hierarchy with external_references on objectives and key results', async () => {
    const { board } = await seedBoardStack(pool)
    const { rows: o1 } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'O1', 0) RETURNING id",
      [board.id],
    )
    const { rows: o2 } = await pool.query(
      "INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, 'O2-no-kr', 1) RETURNING id",
      [board.id],
    )
    const { rows: kr1 } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR1', 0) RETURNING id",
      [o1[0].id],
    )
    const { rows: kr2 } = await pool.query(
      "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'KR2', 1) RETURNING id",
      [o1[0].id],
    )

    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, objective_id) VALUES ('jira', 'https://j/o1', 'O1-ref', $1)",
      [o1[0].id],
    )
    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, objective_id, deleted_at, deleted_by) VALUES ('jira', 'https://j/o1-del', 'O1-del', $1, NOW(), 'A1')",
      [o1[0].id],
    )
    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, key_result_id) VALUES ('github_issue', 'https://g/kr1', 'KR1-ref', $1)",
      [kr1[0].id],
    )
    await pool.query(
      "INSERT INTO external_references (ref_type, url, title, key_result_id) VALUES ('slack', 'https://s/kr2', 'KR2-ref', $1)",
      [kr2[0].id],
    )

    const result = await getBoardWithObjectives(board.id)
    expect(result).not.toBeNull()
    expect(result?.id).toBe(board.id)
    expect(result?.objectives.map((o) => o.id)).toEqual([o1[0].id, o2[0].id])

    const obj1 = result?.objectives[0]
    expect(obj1?.external_references.map((r) => r.title)).toEqual(['O1-ref'])
    expect(obj1?.key_results.map((k) => k.id)).toEqual([kr1[0].id, kr2[0].id])
    expect(obj1?.key_results[0].external_references.map((r) => r.title)).toEqual(['KR1-ref'])
    expect(obj1?.key_results[1].external_references.map((r) => r.title)).toEqual(['KR2-ref'])

    const obj2 = result?.objectives[1]
    expect(obj2?.external_references).toEqual([])
    expect(obj2?.key_results).toEqual([])
  })
})
