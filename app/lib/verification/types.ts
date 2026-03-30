/**
 * Types for the verification system
 *
 * This module defines all types used for:
 * - Fetching data from GitHub
 * - Storing data in database snapshots
 * - Stateless verification logic
 * - Verification results
 */

// =============================================================================
// Schema Version
// =============================================================================

/**
 * Current schema version for GitHub data snapshots.
 * Increment this when the data structure changes and re-fetching is needed.
 */
export const CURRENT_SCHEMA_VERSION = 2

// =============================================================================
// Exhaustive Check Helper
// =============================================================================

/**
 * Helper function for exhaustive switch checks.
 * If TypeScript complains that the argument is not of type `never`,
 * it means you've forgotten to handle a case in your switch statement.
 *
 * @example
 * switch (mode) {
 *   case 'off': return ...
 *   case 'dependabot_only': return ...
 *   case 'all': return ...
 *   default: return assertNever(mode) // Error if new mode added but not handled
 * }
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled value: ${JSON.stringify(value)}`)
}

// =============================================================================
// Implicit Approval Mode
// =============================================================================

/**
 * All valid implicit approval modes.
 * Add new modes here - TypeScript will enforce handling in all switch statements.
 */
export const IMPLICIT_APPROVAL_MODES = ['off', 'dependabot_only', 'all'] as const
export type ImplicitApprovalMode = (typeof IMPLICIT_APPROVAL_MODES)[number]

/**
 * Human-readable labels for implicit approval modes
 */
const IMPLICIT_APPROVAL_MODE_LABELS: Record<ImplicitApprovalMode, string> = {
  off: 'Av',
  dependabot_only: 'Kun Dependabot',
  all: 'Alle PRer',
}

/**
 * Descriptions for implicit approval modes
 */
const IMPLICIT_APPROVAL_MODE_DESCRIPTIONS: Record<ImplicitApprovalMode, string> = {
  off: 'Ingen implisitt godkjenning - krever eksplisitt review-godkjenning',
  dependabot_only: 'Dependabot-PRer med kun Dependabot-commits godkjennes når merget av annen bruker',
  all: 'PRer godkjennes når merger er forskjellig fra PR-forfatter og siste commit-forfatter',
}

// =============================================================================
// Verification Status
// =============================================================================

/**
 * All valid verification statuses.
 * Add new statuses here - TypeScript will enforce handling in all switch statements.
 */
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

/**
 * Human-readable labels for verification statuses
 */
const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  approved: 'Godkjent',
  implicitly_approved: 'Implisitt godkjent',
  unverified_commits: 'Ikke verifisert',
  pending_baseline: 'Første deployment',
  no_changes: 'Ingen endringer',
  manually_approved: 'Manuelt godkjent',
  unauthorized_repository: 'Ikke godkjent repo',
  unauthorized_branch: 'Ikke på godkjent branch',
  legacy: 'Legacy',
  error: 'Feil',
}

// =============================================================================
// Repository Status
// =============================================================================

/**
 * Status of the repository relative to the monitored application.
 * - active: The repo is the current, approved source
 * - historical: The repo was previously used but has been superseded
 * - pending_approval: The repo was detected but not yet approved
 * - unknown: No repository record exists for this deployment's repo
 */
export const REPOSITORY_STATUSES = ['active', 'historical', 'pending_approval', 'unknown'] as const
export type RepositoryStatus = (typeof REPOSITORY_STATUSES)[number]

// =============================================================================
// Unverified Commit Reasons
// =============================================================================

/**
 * All valid reasons for unverified commits.
 */
export const UNVERIFIED_REASONS = [
  'no_pr',
  'no_approved_reviews',
  'approval_before_last_commit',
  'pr_not_approved',
] as const
export type UnverifiedReason = (typeof UNVERIFIED_REASONS)[number]

/**
 * Human-readable labels for unverified reasons
 */
const UNVERIFIED_REASON_LABELS: Record<UnverifiedReason, string> = {
  no_pr: 'Ingen PR funnet',
  no_approved_reviews: 'Ingen godkjent review',
  approval_before_last_commit: 'Godkjenning før siste commit',
  pr_not_approved: 'PR ikke godkjent',
}

// =============================================================================
// Approval Methods
// =============================================================================

/**
 * All valid approval methods.
 */
export const APPROVAL_METHODS = ['pr_review', 'implicit', 'base_merge', 'no_changes', 'pending_baseline'] as const
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number] | null

// =============================================================================
// Data Types for Granular Storage
// =============================================================================

/**
 * Types of PR data that can be fetched/stored separately
 */
export type PrDataType = 'metadata' | 'reviews' | 'commits' | 'comments' | 'checks' | 'files'

/**
 * Types of commit data that can be fetched/stored separately
 */
export type CommitDataType = 'metadata' | 'status' | 'checks' | 'prs'

// =============================================================================
// Snapshot Types (Database Storage)
// =============================================================================

/**
 * Base interface for all snapshots
 */
export interface SnapshotBase {
  id: number
  schemaVersion: number
  fetchedAt: Date
  source: 'github' | 'cached'
  githubAvailable: boolean
}

/**
 * PR data snapshot from database
 */
export interface PrSnapshot extends SnapshotBase {
  owner: string
  repo: string
  prNumber: number
  dataType: PrDataType
  data: unknown
}

/**
 * Commit data snapshot from database
 */
export interface CommitSnapshot extends SnapshotBase {
  owner: string
  repo: string
  sha: string
  dataType: CommitDataType
  data: unknown
}

/**
 * Compare snapshot from database (commits between two SHAs)
 */
export interface CompareSnapshot extends SnapshotBase {
  owner: string
  repo: string
  baseSha: string
  headSha: string
  data: CompareData
}

/**
 * Data stored in compare snapshots
 */
export interface CompareData {
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

// =============================================================================
// PR Data Types (what's stored in snapshots)
// =============================================================================

/**
 * PR metadata (stored in 'metadata' snapshot)
 */
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
  // Extended fields (schema version 2+)
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

/**
 * PR review (stored in 'reviews' snapshot as array)
 */
export interface PrReview {
  id: number
  username: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED'
  submittedAt: string
  body: string | null
}

/**
 * PR commit (stored in 'commits' snapshot as array)
 */
export interface PrCommit {
  sha: string
  message: string
  authorUsername: string
  authorDate: string
  committerDate: string
  isMergeCommit: boolean
  parentShas: string[]
}

/**
 * PR comment (stored in 'comments' snapshot as array)
 */
export interface PrComment {
  id: number
  username: string
  body: string
  createdAt: string
  updatedAt: string
}

/**
 * PR check/status (stored in 'checks' snapshot)
 */
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

// =============================================================================
// Commit Data Types
// =============================================================================

/**
 * Commit metadata (stored in 'metadata' snapshot)
 */
interface CommitMetadata {
  sha: string
  message: string
  authorUsername: string
  authorDate: string
  committerUsername: string
  committerDate: string
  parentShas: string[]
  isMergeCommit: boolean
  htmlUrl: string
}

/**
 * Commit status (stored in 'status' snapshot)
 */
interface CommitStatus {
  state: 'pending' | 'success' | 'failure' | 'error'
  totalCount: number
  statuses: Array<{
    context: string
    state: 'pending' | 'success' | 'failure' | 'error'
    description: string | null
    targetUrl: string | null
  }>
}

/**
 * Associated PRs for a commit (stored in 'prs' snapshot)
 */
interface CommitPrs {
  prs: Array<{
    number: number
    title: string
    state: 'open' | 'closed' | 'merged'
    baseRef: string
    merged: boolean
    mergedAt: string | null
  }>
}

// =============================================================================
// Verification Input (what the stateless verifier receives)
// =============================================================================

/**
 * Complete input for verifying a deployment
 * This contains ALL data needed - no database/API calls during verification
 */
export interface VerificationInput {
  // Deployment info
  deploymentId: number
  commitSha: string
  repository: string
  environmentName: string
  baseBranch: string

  // Repository status (active, historical, pending_approval, unknown)
  repositoryStatus: RepositoryStatus

  // Whether the deployed commit is on the base branch (null = unknown/API error)
  commitOnBaseBranch: boolean | null

  // App settings
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings

  // Previous deployment (for determining commit range)
  previousDeployment: {
    id: number
    commitSha: string
    createdAt: string
  } | null

  // The deployed commit's PR (if any)
  deployedPr: {
    number: number
    url: string
    metadata: PrMetadata
    reviews: PrReview[]
    commits: PrCommit[]
  } | null

  // All commits between previous and current deployment
  commitsBetween: Array<{
    sha: string
    message: string
    authorUsername: string
    authorDate: string
    isMergeCommit: boolean
    parentShas: string[]
    htmlUrl: string
    // PR info for this commit (if found)
    pr: {
      number: number
      title: string
      url: string
      reviews: PrReview[]
      commits: PrCommit[]
      baseBranch: string
      rebaseMatched?: boolean
    } | null
  }>

  // Metadata about data freshness
  dataFreshness: {
    deployedPrFetchedAt: Date | null
    commitsFetchedAt: Date | null
    schemaVersion: number
  }

  // Whether the GitHub compare API failed (404, network error, etc.)
  compareFailed?: boolean
}

/**
 * Settings for implicit approval (single-author PRs, etc.)
 */
export interface ImplicitApprovalSettings {
  mode: ImplicitApprovalMode
}

// =============================================================================
// Verification Result (what the stateless verifier returns)
// =============================================================================

/**
 * Result from verifying a deployment
 */
export interface VerificationResult {
  // Overall result
  hasFourEyes: boolean
  status: VerificationStatus

  // Details about the deployed PR
  deployedPr: {
    number: number
    url: string
    title: string
    author: string
  } | null

  // Unverified commits (if any)
  unverifiedCommits: UnverifiedCommit[]

  // Approval details
  approvalDetails: {
    method: ApprovalMethod
    approvers: string[]
    reason: string
  }

  // Metadata
  verifiedAt: Date
  schemaVersion: number
}

/**
 * An unverified commit
 */
export interface UnverifiedCommit {
  sha: string
  message: string
  author: string
  date: string
  htmlUrl: string
  prNumber: number | null
  reason: UnverifiedReason
}

// Note: UnverifiedReason and VerificationStatus are defined at the top of this file
// using const arrays for exhaustive checking support

// =============================================================================
// Verification Run (stored in database)
// =============================================================================

/**
 * A verification run record from the database
 */
interface VerificationRun {
  id: number
  deploymentId: number
  schemaVersion: number
  runAt: Date
  prSnapshotIds: number[]
  commitSnapshotIds: number[]
  result: VerificationResult
  status: VerificationStatus
  hasFourEyes: boolean
}
