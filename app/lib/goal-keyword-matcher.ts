import { endOfDay } from '~/lib/date-utils'

export function pickLatestBoard<T extends { boardId: number; periodStart: Date }>(items: T[]): T | null {
  if (items.length === 0) return null
  return items.reduce((best, item) => {
    if (item.periodStart > best.periodStart) return item
    if (item.periodStart.getTime() === best.periodStart.getTime() && item.boardId > best.boardId) return item
    return best
  })
}

export interface BoardKeywordSource {
  boardId: number
  periodStart: Date
  periodEnd: Date
  objectiveId: number
  keyResultId: number | null
  keyword: string
}

export interface CommitInfo {
  message: string
  date: Date
}

interface KeywordMatch {
  boardId: number
  objectiveId: number
  keyResultId: number | null
  keyword: string
}

interface RawMatch {
  keyword: string
  boardId: number
  objectiveId: number
  keyResultId: number | null
  periodStart: Date
}

export function matchCommitKeywords(commits: CommitInfo[], boardKeywords: BoardKeywordSource[]): KeywordMatch[] {
  if (commits.length === 0 || boardKeywords.length === 0) return []

  const rawMatches: RawMatch[] = []

  for (const commit of commits) {
    const messageLower = commit.message.toLowerCase()

    for (const bk of boardKeywords) {
      if (commit.date < bk.periodStart || commit.date > endOfDay(bk.periodEnd)) continue

      if (messageLower.includes(bk.keyword.toLowerCase())) {
        rawMatches.push({
          keyword: bk.keyword.toLowerCase(),
          boardId: bk.boardId,
          objectiveId: bk.objectiveId,
          keyResultId: bk.keyResultId,
          periodStart: bk.periodStart,
        })
      }
    }
  }

  const matchesByKeyword = new Map<string, RawMatch[]>()
  for (const m of rawMatches) {
    const group = matchesByKeyword.get(m.keyword) ?? []
    group.push(m)
    matchesByKeyword.set(m.keyword, group)
  }

  const winnerPerKeyword = new Map<string, number>()
  for (const [keyword, group] of matchesByKeyword) {
    const winner = pickLatestBoard(group)
    if (winner) winnerPerKeyword.set(keyword, winner.boardId)
  }

  const seen = new Set<string>()
  const results: KeywordMatch[] = []

  for (const m of rawMatches) {
    if (winnerPerKeyword.get(m.keyword) !== m.boardId) continue

    const dedupeKey = `${m.objectiveId}:${m.keyResultId ?? 'obj'}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    results.push({
      boardId: m.boardId,
      objectiveId: m.objectiveId,
      keyResultId: m.keyResultId,
      keyword: m.keyword,
    })
  }

  return results
}
