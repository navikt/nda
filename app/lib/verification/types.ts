export const CURRENT_SCHEMA_VERSION = 4

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled value: ${JSON.stringify(value)}`)
}

export const IMPLICIT_APPROVAL_MODES = ['off', 'dependabot_only', 'all'] as const
export type ImplicitApprovalMode = (typeof IMPLICIT_APPROVAL_MODES)[number]

const _IMPLICIT_APPROVAL_MODE_LABELS: Record<ImplicitApprovalMode, string> = {
  off: 'Av',
  dependabot_only: 'Kun Dependabot',
  all: 'Alle PRer',
}
export const IMPLICIT_APPROVAL_MODE_LABELS = _IMPLICIT_APPROVAL_MODE_LABELS

const _IMPLICIT_APPROVAL_MODE_DESCRIPTIONS: Record<ImplicitApprovalMode, string> = {
  off: 'Ingen implisitt godkjenning - krever eksplisitt review-godkjenning',
  dependabot_only: 'Dependabot-PRer med kun Dependabot-commits godkjennes når merget av annen bruker',
  all: 'PRer godkjennes når merger er forskjellig fra PR-forfatter og siste commit-forfatter',
}
export const IMPLICIT_APPROVAL_MODE_DESCRIPTIONS = _IMPLICIT_APPROVAL_MODE_DESCRIPTIONS

export function isImplicitApprovalMode(value: string): value is ImplicitApprovalMode {
  return IMPLICIT_APPROVAL_MODES.includes(value as ImplicitApprovalMode)
}

export const VERIFICATION_STATUSES = [
  'approved',
  'implicitly_approved',
  'unverified_commits',
  'pending_baseline',
  'no_changes',
  'manually_approved',
  'unauthorized_repository',
  'unauthorized_branch',
  'legacy',
  'error',
] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

const _VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  approved: 'Godkjent',
  implicitly_approved: 'Implisitt godkjent',
  unverified_commits: 'Ikke godkjent',
  pending_baseline: 'Første deployment - venter',
  no_changes: 'Ingen endringer',
  manually_approved: 'Manuelt godkjent',
  unauthorized_repository: 'Ikke godkjent repo',
  unauthorized_branch: 'Ikke på godkjent branch',
  legacy: 'Legacy',
  error: 'Feil',
}

export const REPOSITORY_STATUSES = ['active', 'historical', 'pending_approval', 'unknown'] as const
export type RepositoryStatus = (typeof REPOSITORY_STATUSES)[number]

export const UNVERIFIED_REASONS = [
  'no_pr',
  'no_approved_reviews',
  'approval_before_last_commit',
  'pr_not_approved',
] as const
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number]

const _UNVERIFIED_REASON_LABELS: Record<UnverifiedReason, string> = {
  no_pr: 'Ingen PR funnet',
  no_approved_reviews: 'Ingen godkjent review',
  approval_before_last_commit: 'Godkjenning før siste commit',
  pr_not_approved: 'PR ikke godkjent',
}
export const UNVERIFIED_REASON_LABELS = _UNVERIFIED_REASON_LABELS

export const UNVERIFIED_REASON_DESCRIPTIONS: Record<UnverifiedReason, string> = {
  no_pr: 'Committen ble pushet direkte til main uten en pull request.',
  no_approved_reviews: 'Pull requesten har ingen godkjent code review.',
  approval_before_last_commit:
    'Pull requesten ble godkjent, men det ble pushet nye commits etter godkjenningen. Endringene i de siste committene er ikke sett av en annen person.',
  pr_not_approved: 'Pull requesten er ikke godkjent.',
}

export const APPROVAL_METHODS = ['pr_review', 'implicit', 'base_merge', 'no_changes', 'pending_baseline'] as const
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number] | null

export type PrDataType = 'metadata' | 'reviews' | 'commits' | 'comments' | 'checks' | 'files'

export type CommitDataType = 'metadata' | 'status' | 'checks' | 'prs'

export interface SnapshotBase {
  id: number
  schemaVersion: number
  fetchedAt: Date
  source: 'github' | 'cached'
  githubAvailable: boolean
}

export interface PrSnapshot extends SnapshotBase {
  owner: string
  repo: string
  prNumber: number
  dataType: PrDataType
  data: unknown
}

export interface CommitSnapshot extends SnapshotBase {
  owner: string
  repo: string
  sha: string
  dataType: CommitDataType
  data: unknown
}

export interface CompareSnapshot extends SnapshotBase {
  owner: string
  repo: string
  baseSha: string
  headSha: string
  data: CompareData
}

export interface CompareSummary {
  status: string
  aheadBy: number
  behindBy: number
  totalCommits: number
  changedFiles: number
  noDiffDetected: boolean
}

export interface CompareData {
  compare: CompareSummary
  commits: Array<{
    sha: string
    message: string
    authorUsername: string
    authorDate: string
    committerDate: string
    parentShas: string[]
    isMergeCommit: boolean
    htmlUrl: string
  }>
}

export interface PrMetadata {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  merged: boolean
  draft: boolean
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
  baseBranch: string
  baseSha: string
  headBranch: string
  headSha: string
  mergeCommitSha: string | null
  author: {
    username: string
    avatarUrl?: string
  }
  mergedBy: {
    username: string
    avatarUrl?: string
  } | null
  labels: string[]
  commitsCount: number
  changedFiles: number
  additions: number
  deletions: number
  commentsCount?: number
  reviewCommentsCount?: number
  locked?: boolean
  mergeable?: boolean | null
  mergeableState?: string | null
  rebaseable?: boolean | null
  maintainerCanModify?: boolean
  autoMerge?: {
    enabledBy: string
    mergeMethod: string
  } | null
  merger?: {
    username: string
    avatarUrl?: string
  } | null
  assignees?: Array<{
    username: string
    avatarUrl?: string
  }>
  requestedReviewers?: Array<{
    username: string
    avatarUrl?: string
  }>
  requestedTeams?: Array<{
    name: string
    slug: string
  }>
  milestone?: {
    title: string
    number: number
    state: string
  } | null
  checksPassed?: boolean | null
}

export interface PrReview {
  id: number
  username: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED'
  submittedAt: string
  body: string | null
}

export interface PrCommit {
  sha: string
  message: string
  authorUsername: string
  authorDate: string
  committerDate: string
  isMergeCommit: boolean
  parentShas: string[]
}

export interface PrComment {
  id: number
  username: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface PrChecks {
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null
  checkRuns: Array<{
    id: number
    name: string
    status: 'queued' | 'in_progress' | 'completed'
    conclusion: string | null
    startedAt: string | null
    completedAt: string | null
    htmlUrl?: string | null
    headSha?: string
    detailsUrl?: string | null
    externalId?: string | null
    checkSuiteId?: number | null
    app?: {
      name: string
      slug: string | null
    } | null
    output?: {
      title: string | null
      summary: string | null
      text: string | null
      annotationsCount: number
    } | null
  }>
  statuses: Array<{
    context: string
    state: 'pending' | 'success' | 'failure' | 'error'
    description: string | null
    targetUrl: string | null
  }>
}

export interface VerificationInput {
  deploymentId: number
  commitSha: string
  repository: string
  environmentName: string
  baseBranch: string

  repositoryStatus: RepositoryStatus

  commitOnBaseBranch: boolean | null

  detectedBranchName?: string

  detectedTitle?: string
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings

  previousDeployment: {
    id: number
    commitSha: string
    createdAt: string
  } | null

  deployedPr: {
    number: number
    url: string
    metadata: PrMetadata
    reviews: PrReview[]
    commits: PrCommit[]
  } | null

  commitsBetween: Array<{
    sha: string
    message: string
    authorUsername: string
    authorDate: string
    isMergeCommit: boolean
    parentShas: string[]
    htmlUrl: string
    pr: {
      number: number
      title: string
      url: string
      reviews: PrReview[]
      commits: PrCommit[]
      baseBranch: string
      rebaseMatched?: boolean
    } | null
    mismatchedBaseBranches?: string[]
    mismatchedPrNumbers?: number[]
  }>

  compareSummary: CompareSummary | null

  dataFreshness: {
    deployedPrFetchedAt: Date | null
    commitsFetchedAt: Date | null
    schemaVersion: number
  }

  compareFailed?: boolean

  nearbyApprovedDeployWithSameCommit?: {
    deploymentId: number
    status: string
  }

  nearbyApprovedDeploy?: {
    deploymentId: number
    commitSha: string
    status: string
  }

  branchMismatch?: {
    expectedBranch: string
    detectedBranches: string[]
    prNumbers: number[]
  }
}

export interface ImplicitApprovalSettings {
  mode: ImplicitApprovalMode
}

export interface VerificationResult {
  hasFourEyes: boolean
  status: VerificationStatus

  deployedPr: {
    number: number
    url: string
    title: string
    author: string
  } | null

  unverifiedCommits: UnverifiedCommit[]

  approvalDetails: {
    method: ApprovalMethod
    approvers: string[]
    reason: string
  }

  verifiedAt: Date
  schemaVersion: number

  branchMismatch?: {
    expectedBranch: string
    detectedBranches: string[]
    prNumbers: number[]
  }

  detectedBranchName?: string

  detectedTitle?: string
}

export interface UnverifiedCommit {
  sha: string
  message: string
  author: string
  date: string
  htmlUrl: string
  prNumber: number | null
  reason: UnverifiedReason
}
