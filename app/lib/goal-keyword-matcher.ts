import { endOfDay } from '~/lib/date-utils'

/**
 * Select the winning board item: latest periodStart wins, tiebreak by highest boardId.
 * Used by both keyword matching and Dependabot target resolution.
 */
export function pickLatestBoard<T extends { boardId: number; periodStart: Date }>(items: T[]): T | null {
  if (items.length === 0) return null
  return items.reduce((best, item) => {
    if (item.periodStart > best.periodStart) return item
    if (item.periodStart.getTime() === best.periodStart.getTime() && item.boardId > best.boardId) return item
    return best
  })
}

/**
 * Pure keyword matching logic for auto-linking deployments to board goals.
 *
 * Rules:
 * - Keywords are matched case-insensitively against commit messages
 * - Only boards whose period covers the commit date are eligible
 * - If a keyword matches in multiple boards, the chronologically latest board wins (by periodStart)
 * - Duplicate matches (same objective/key_result) are deduplicated
 */

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

/**
 * Match commit messages against goal keywords from active boards.
 * When a keyword matches in multiple boards, the board with the latest periodStart wins.
 */
export function matchCommitKeywords(commits: CommitInfo[], boardKeywords: BoardKeywordSource[]): KeywordMatch[] {
  if (commits.length === 0 || boardKeywords.length === 0) return []

  // Collect all raw matches: for each commit, find keywords in active boards
  const rawMatches: RawMatch[] = []

  for (const commit of commits) {
    const messageLower = commit.message.toLowerCase()

    for (const bk of boardKeywords) {
      // Check board period covers commit date
      if (commit.date < bk.periodStart || commit.date > endOfDay(bk.periodEnd)) continue

      // Case-insensitive keyword search
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

  // Resolve multi-board matches: for each keyword, keep only matches from the latest board
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

  // Filter to only matches from the winning board, deduplicate by (objectiveId, keyResultId)
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
