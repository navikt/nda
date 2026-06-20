import { describe, expect, it } from 'vitest'
import { type BoardKeywordSource, type CommitInfo, matchCommitKeywords, pickLatestBoard } from '../goal-keyword-matcher'

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

  it('picks the latest board when keyword matches in two boards with same period', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 stuff', new Date('2026-02-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board1Start, periodEnd: board1End }),
      ],
    )
    expect(result).toEqual([{ boardId: 2, objectiveId: 20, keyResultId: null, keyword: 'pen-123' }])
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
    expect(result).toEqual([{ boardId: 2, objectiveId: 20, keyResultId: null, keyword: 'pen-123' }])
  })

  it('picks the latest board when commits span two board periods with same keyword', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 part 1', new Date('2026-02-15')), commit('fix: PEN-123 part 2', new Date('2026-05-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board2Start, periodEnd: board2End }),
      ],
    )
    expect(result).toEqual([{ boardId: 2, objectiveId: 20, keyResultId: null, keyword: 'pen-123' }])
  })

  it('allows different keywords to match in different boards', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 part 1', new Date('2026-02-15')), commit('feat: SMOD-42 part 2', new Date('2026-05-15'))],
      [
        kw('PEN-123', 10, { boardId: 1, periodStart: board1Start, periodEnd: board1End }),
        kw('SMOD-42', 20, { boardId: 2, periodStart: board2Start, periodEnd: board2End }),
      ],
    )
    expect(result).toHaveLength(2)
  })

  it('resolves each keyword independently when one matches multiple boards', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 SMOD-42', new Date('2026-02-15'))],
      [
        kw('PEN-123', 10, { boardId: 1 }),
        kw('PEN-123', 20, { boardId: 2, periodStart: board1Start, periodEnd: board1End }),
        kw('SMOD-42', 30, { boardId: 1 }),
      ],
    )
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ boardId: 2, objectiveId: 20, keyResultId: null, keyword: 'pen-123' })
    expect(result).toContainEqual({ boardId: 1, objectiveId: 30, keyResultId: null, keyword: 'smod-42' })
  })

  it('matches keyword as substring in commit message', () => {
    const result = matchCommitKeywords([commit('refactor(PEN-123): cleanup')], [kw('PEN-123', 10)])
    expect(result).toHaveLength(1)
  })

  it('matches commit on the exact period end date with later timestamp', () => {
    const result = matchCommitKeywords(
      [commit('fix: PEN-123 last day fix', new Date('2026-03-31T14:30:00Z'))],
      [kw('PEN-123', 10, { periodStart: board1Start, periodEnd: board1End })],
    )
    expect(result).toHaveLength(1)
    expect(result[0].keyword).toBe('pen-123')
  })

  describe('branch name as keyword source', () => {
    it('matches keyword from branch name prefix (e.g. sp-bau/feature)', () => {
      const result = matchCommitKeywords([commit('sp-bau/refactor-components')], [kw('SP-BAU', 10)])
      expect(result).toEqual([{ boardId: 1, objectiveId: 10, keyResultId: null, keyword: 'sp-bau' }])
    })

    it('matches branch name case-insensitively', () => {
      const result = matchCommitKeywords([commit('SP-BAU/whatever')], [kw('sp-bau', 10)])
      expect(result).toEqual([{ boardId: 1, objectiveId: 10, keyResultId: null, keyword: 'sp-bau' }])
    })

    it('matches when branch name is exactly the keyword (no separator)', () => {
      const result = matchCommitKeywords([commit('sp-bau')], [kw('SP-BAU', 10)])
      expect(result).toHaveLength(1)
    })

    it('does not duplicate if keyword also appears in a commit message', () => {
      const result = matchCommitKeywords(
        [commit('sp-bau/feature'), commit('fix: SP-BAU update rules')],
        [kw('SP-BAU', 10)],
      )
      expect(result).toHaveLength(1)
    })
  })
})

describe('pickLatestBoard', () => {
  it('returns null for empty array', () => {
    expect(pickLatestBoard([])).toBeNull()
  })

  it('returns the single item for a one-element array', () => {
    const item = { boardId: 1, periodStart: new Date('2026-01-01') }
    expect(pickLatestBoard([item])).toBe(item)
  })

  it('picks the item with latest periodStart', () => {
    const older = { boardId: 1, periodStart: new Date('2026-01-01'), name: 'older' }
    const newer = { boardId: 2, periodStart: new Date('2026-04-01'), name: 'newer' }
    expect(pickLatestBoard([older, newer])).toBe(newer)
    expect(pickLatestBoard([newer, older])).toBe(newer)
  })

  it('tiebreaks by highest boardId when periodStart is equal', () => {
    const a = { boardId: 5, periodStart: new Date('2026-01-01') }
    const b = { boardId: 10, periodStart: new Date('2026-01-01') }
    expect(pickLatestBoard([a, b])).toBe(b)
    expect(pickLatestBoard([b, a])).toBe(b)
  })

  it('preserves extra properties on the returned item', () => {
    const item = { boardId: 1, periodStart: new Date('2026-01-01'), objectiveId: 42, keyResultId: 7 }
    expect(pickLatestBoard([item])).toEqual(item)
  })
})
