import { endOfDay } from '~/lib/date-utils'

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
  // "Latest" = highest periodStart. Ties broken by highest boardId (most recently created).
  const latestBoardPerKeyword = new Map<string, { boardId: number; periodStart: Date }>()
  for (const m of rawMatches) {
    const current = latestBoardPerKeyword.get(m.keyword)
    if (
      !current ||
      m.periodStart > current.periodStart ||
      (m.periodStart.getTime() === current.periodStart.getTime() && m.boardId > current.boardId)
    ) {
      latestBoardPerKeyword.set(m.keyword, { boardId: m.boardId, periodStart: m.periodStart })
    }
  }

  // Filter to only matches from the winning board, deduplicate by (objectiveId, keyResultId)
  const seen = new Set<string>()
  const results: KeywordMatch[] = []

  for (const m of rawMatches) {
    const winner = latestBoardPerKeyword.get(m.keyword)
    if (winner?.boardId !== m.boardId) continue

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
