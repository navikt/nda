import type {
  RepositoryDeliveryCommitAssessmentReason,
  RepositoryDeliveryCommitAssessmentStatus,
} from './repository-code-delivery/interval-assessment'

export interface RepositoryApprovalReview {
  snapshotId: number
  baseSha: string
  headSha: string
  createdAt: string
  reviewer: string
  previewToken: string
  defaultBranch: string | null
  implicitApprovalMode: string
  commits: Array<{
    sha: string
    message: string
    authorLogin: string | null
    authorNavIdent: string | null
    authorDate: string
    committerDate: string
    prStatus: RepositoryDeliveryCommitAssessmentStatus
    prReason: RepositoryDeliveryCommitAssessmentReason
    pullRequestNumber: number | null
    associations: { complete: boolean; pullRequests: Array<{ number: number; baseBranch: string }> } | null
    unavailableReason: string | null
  }>
  pullRequests: Array<{
    number: number
    headSha: string | null
    baseBranch: string | null
    authorLogin: string | null
    mergedByLogin: string | null
    mergeCommitSha: string | null
    commitCount: number | null
    commits: Array<{ sha: string; authorLogin: string | null; authorDate: string; committerDate: string }>
    reviews: Array<{ username: string; state: string; submittedAt: string; commitSha: string | null }>
  }>
}

export type RepositoryApprovalPreview = Omit<RepositoryApprovalReview, 'snapshotId' | 'createdAt' | 'reviewer'>

export function isRepositoryApprovalId(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
}

export function parseRepositoryApprovalId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return isRepositoryApprovalId(id) ? id : null
}

export function isDocumentationUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function parseReviewTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const [hours, minutes, seconds] = value.slice(11, 19).split(':').map(Number)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day
    ? date
    : null
}
