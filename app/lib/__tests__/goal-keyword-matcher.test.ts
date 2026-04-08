import { describe, expect, it } from 'vitest'
import { type BoardKeywordSource, type CommitInfo, matchCommitKeywords } from '../goal-keyword-matcher'

const board1Start = new Date('2026-01-01')
const board1End = new Date('2026-03-31')
const board2Start = new Date('2026-04-01')
const board2End = new Date('2026-06-30')

function kw(
  keyword: string,
  objectiveId: number,
  opts?: { boardId?: number; keyResultId?: number | null; periodStart?: Date; periodEnd?: Date },
): BoardKeywordSource {
  return {
    boardId: opts?.boardId ?? 1,
    periodStart: opts?.periodStart ?? board1Start,
    periodEnd: opts?.periodEnd ?? board1End,
    objectiveId,
    keyResultId: opts?.keyResultId ?? null,
    keyword,
  }
}

function commit(message: string, date?: Date): CommitInfo {
  return { message, date: date ?? new Date('2026-02-15') }
}

describe('matchCommitKeywords', () => {
  it('returns empty for no commits', () => {
    const result = matchCommitKeywords([], [kw('PEN-123', 1)])
    expect(result).toEqual([])
  })

  it('returns empty for no keywords', () => {
    const result = matchCommitKeywords([commit('fix: PEN-123 stuff')], [])
    expect(result).toEqual([])
  })

  it('matches a single keyword in a commit message', () => {
    const result = matchCommitKeywords([commit('fix: PEN-123 update rules')], [kw('PEN-123', 10)])
    expect(result).toEqual([{ boardId: 1, objectiveId: 10, keyResultId: null, keyword: 'pen-123' }])
  })

  it('matches case-insensitively', () => {
    const result = matchCommitKeywords([commit('feat: penregler update')], [kw('PENREGLER', 10)])
    expect(result).toHaveLength(1)
    expect(result[0].keyword).toBe('penregler')
  })

  it('matches keyword on a key result', () => {
    const result = matchCommitKeywords([commit('fix: SMOD-42 component')], [kw('SMOD-42', 10, { keyResultId: 20 })])
    expect(result).toEqual([{ boardId: 1, objectiveId: 10, keyResultId: 20, keyword: 'smod-42' }])
  })

  it('matches multiple keywords from different commits', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 rules'), commit('feat: SMOD-42 component')],
      [kw('PEN-123', 10), kw('SMOD-42', 20, { keyResultId: 30 })],
    )
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.keyword).sort()).toEqual(['pen-123', 'smod-42'])
  })

  it('deduplicates same objective matched from multiple commits', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 part 1'), commit('fix: PEN-123 part 2')],
      [kw('PEN-123', 10)],
    )
    expect(result).toHaveLength(1)
  })

  it('drops ambiguous keyword matching in two boards', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 stuff', new Date('2026-02-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board1Start, periodEnd: board1End }),
      ],
    )
    expect(result).toEqual([])
  })

  it('does not match keyword outside board period', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 stuff', new Date('2026-05-15'))],
      [kw('PEN-123', 10, { periodStart: board1Start, periodEnd: board1End })],
    )
    expect(result).toEqual([])
  })

  it('matches keyword only from the board active for commit date', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 stuff', new Date('2026-05-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board2Start, periodEnd: board2End }),
      ],
    )
    // Only board 2 covers May 2026, so it's unambiguous
    expect(result).toEqual([{ boardId: 2, objectiveId: 20, keyResultId: null, keyword: 'pen-123' }])
  })

  it('handles commits spanning two board periods with same keyword', () => {
    // Commit A in Q1 → board 1, Commit B in Q2 → board 2
    // Same keyword in both boards, but each commit only matches one board
    // However the keyword itself matches in two boards across all commits → ambiguous
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 part 1', new Date('2026-02-15')), commit('fix: PEN-123 part 2', new Date('2026-05-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board2Start, periodEnd: board2End }),
      ],
    )
    // Ambiguous: same keyword matched in two different boards
    expect(result).toEqual([])
  })

  it('allows different keywords to match in different boards', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 part 1', new Date('2026-02-15')), commit('feat: SMOD-42 part 2', new Date('2026-05-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('SMOD-42', 20, { boardId: 2, periodStart: board2Start, periodEnd: board2End }),
      ],
    )
    // Different keywords → each unambiguous in its own board
    expect(result).toHaveLength(2)
  })

  it('keeps non-ambiguous keywords even when another keyword is ambiguous', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 SMOD-42', new Date('2026-02-15'))],
      [
        kw('PEN-123', 10, { boardId: 1 }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board1Start, periodEnd: board1End }),
        kw('SMOD-42', 30, { boardId: 1 }),
      ],
    )
    // PEN-123 is ambiguous (boards 1+2), but SMOD-42 is unambiguous (board 1 only)
    expect(result).toEqual([{ boardId: 1, objectiveId: 30, keyResultId: null, keyword: 'smod-42' }])
  })

  it('matches keyword as substring in commit message', () => {
    const result = matchCommitKeywords([commit('refactor(PEN-123): cleanup')], [kw('PEN-123', 10)])
    expect(result).toHaveLength(1)
  })
})
