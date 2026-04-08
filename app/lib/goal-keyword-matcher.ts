/**
 * Pure keyword matching logic for auto-linking deployments to board goals.
 *
 * Rules:
 * - Keywords are matched case-insensitively against commit messages
 * - Only boards whose period covers the commit date are eligible
 * - If a keyword matches in two different boards, the match is ambiguous and dropped
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

export interface KeywordMatch {
  boardId: number
  objectiveId: number
  keyResultId: number | null
  keyword: string
}

/**
 * Match commit messages against goal keywords from active boards.
 * Returns only unambiguous matches (keyword found in exactly one board per commit window).
 */
export function matchCommitKeywords(commits: CommitInfo[], boardKeywords: BoardKeywordSource[]): KeywordMatch[] {
  if (commits.length === 0 || boardKeywords.length === 0) return []

  // Collect all raw matches: for each commit, find keywords in active boards
  const rawMatches: Array<{ keyword: string; boardId: number; objectiveId: number; keyResultId: number | null }> = []

  for (const commit of commits) {
    const messageLower = commit.message.toLowerCase()

    for (const bk of boardKeywords) {
      // Check board period covers commit date
      if (commit.date < bk.periodStart || commit.date > bk.periodEnd) continue

      // Case-insensitive keyword search
      if (messageLower.includes(bk.keyword.toLowerCase())) {
        rawMatches.push({
          keyword: bk.keyword.toLowerCase(),
          boardId: bk.boardId,
          objectiveId: bk.objectiveId,
          keyResultId: bk.keyResultId,
        })
      }
    }
  }

  // Ambiguity check: group matches by keyword, discard if matched in multiple boards
  const keywordBoards = new Map<string, Set<number>>()
  for (const m of rawMatches) {
    const boards = keywordBoards.get(m.keyword) ?? new Set()
    boards.add(m.boardId)
    keywordBoards.set(m.keyword, boards)
  }

  const ambiguousKeywords = new Set<string>()
  for (const [keyword, boards] of keywordBoards) {
    if (boards.size > 1) ambiguousKeywords.add(keyword)
  }

  // Filter out ambiguous matches and deduplicate by (objectiveId, keyResultId)
  const seen = new Set<string>()
  const results: KeywordMatch[] = []

  for (const m of rawMatches) {
    if (ambiguousKeywords.has(m.keyword)) continue

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
