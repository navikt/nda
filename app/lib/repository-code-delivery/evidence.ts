import { isFullCommitSha } from '~/lib/git-constants'

export interface RepositoryDeliveryComparisonRange {
  baseSha: string
  headSha: string
}

export interface RepositoryDeliveryReviewEvidence {
  id: number | null
  username: string
  state: string
  submittedAt: string | null
  commitSha: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseRepositoryDeliveryComparisonRange(value: unknown): RepositoryDeliveryComparisonRange | null {
  const range = asRecord(value)
  if (typeof range?.baseSha !== 'string' || typeof range.headSha !== 'string') return null
  if (!isFullCommitSha(range.baseSha) || !isFullCommitSha(range.headSha)) return null
  return { baseSha: range.baseSha, headSha: range.headSha }
}

export function repositoryDeliveryRangeMatches(
  range: RepositoryDeliveryComparisonRange | null,
  delivery: RepositoryDeliveryComparisonRange,
): boolean | null {
  if (!range) return null
  if (!isFullCommitSha(range.baseSha) || !isFullCommitSha(range.headSha)) return null
  if (!isFullCommitSha(delivery.baseSha) || !isFullCommitSha(delivery.headSha)) return null
  return (
    range.baseSha.toLowerCase() === delivery.baseSha.toLowerCase() &&
    range.headSha.toLowerCase() === delivery.headSha.toLowerCase()
  )
}

export function parseRepositoryDeliveryReviews(value: unknown): RepositoryDeliveryReviewEvidence[] | null {
  const rows = Array.isArray(value) ? value : asRecord(value)?.reviews
  if (!Array.isArray(rows)) return null

  const reviews: RepositoryDeliveryReviewEvidence[] = []
  for (const item of rows) {
    const review = asRecord(item)
    if (!review) return null
    const username = review.username
    const state = review.state
    if (typeof username !== 'string' || typeof state !== 'string') return null

    const submittedAt =
      typeof review.submittedAt === 'string'
        ? review.submittedAt
        : typeof review.submitted_at === 'string'
          ? review.submitted_at
          : null
    const commitSha =
      typeof review.commitId === 'string'
        ? review.commitId
        : typeof review.commit_id === 'string'
          ? review.commit_id
          : null

    reviews.push({
      id: typeof review.id === 'number' && Number.isSafeInteger(review.id) ? review.id : null,
      username,
      state,
      submittedAt,
      commitSha,
    })
  }
  return reviews
}
