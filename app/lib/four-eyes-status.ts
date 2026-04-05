/**
 * Four-Eyes Status Constants
 *
 * Centralized definitions for all deployment verification statuses.
 * Use these constants instead of string literals throughout the codebase.
 */

// =============================================================================
// Four-Eyes Status Values
// =============================================================================

/**
 * All valid four_eyes_status values in the database.
 * Add new statuses here - TypeScript will enforce handling in switch statements.
 */
export const FOUR_EYES_STATUSES = [
  'approved', // PR approved via review
  'approved_pr', // Alias for approved (legacy)
  'implicitly_approved', // Approved via implicit approval rules
  'manually_approved', // Manually approved by admin
  'no_changes', // No changes from previous deployment (same commit SHA)
  'pending', // Awaiting verification
  'pending_baseline', // First deployment, awaiting baseline
  'pending_approval', // Alias for pending (legacy)
  'unverified_commits', // Has commits without approved PR
  'approved_pr_with_unreviewed', // Approved PR but has unreviewed commits
  'direct_push', // Direct push to main without PR
  'legacy', // Legacy deployment (before audit)
  'legacy_pending', // Legacy awaiting review
  'repository_mismatch', // Repository doesn't match monitored app
  'unauthorized_repository', // Repository not approved for this app
  'unauthorized_branch', // Deployed commit not on approved branch
  'error', // Error during verification
  'unknown', // Not yet verified (DB default)
] as const

export type FourEyesStatus = (typeof FOUR_EYES_STATUSES)[number]

// =============================================================================
// Status Categorization
// =============================================================================

/**
 * Statuses that indicate deployment is approved (four-eyes verified)
 */
export const APPROVED_STATUSES: FourEyesStatus[] = [
  'approved',
  'approved_pr',
  'implicitly_approved',
  'manually_approved',
  'no_changes',
]

/**
 * SQL fragment for filtering approved deployments.
 * Use in place of `has_four_eyes = true`.
 */
export const APPROVED_STATUSES_SQL = APPROVED_STATUSES.map((s) => `'${s}'`).join(', ')

/**
 * Statuses that indicate deployment is NOT approved
 */
export const NOT_APPROVED_STATUSES: FourEyesStatus[] = [
  'direct_push',
  'unverified_commits',
  'approved_pr_with_unreviewed',
  'unauthorized_repository',
  'unauthorized_branch',
]

/**
 * Statuses that indicate deployment is pending verification
 */
export const PENDING_STATUSES: FourEyesStatus[] = ['pending', 'pending_baseline', 'pending_approval', 'unknown']

/**
 * Statuses that indicate legacy deployments
 */
export const LEGACY_STATUSES: FourEyesStatus[] = ['legacy', 'legacy_pending']

// =============================================================================
// Human-Readable Labels
// =============================================================================

export const FOUR_EYES_STATUS_LABELS: Record<FourEyesStatus, string> = {
  approved: 'Godkjent',
  approved_pr: 'Godkjent PR',
  implicitly_approved: 'Implisitt godkjent',
  manually_approved: 'Manuelt godkjent',
  no_changes: 'Ingen endringer',
  pending: 'Venter',
  pending_baseline: 'Første deploy — venter',
  pending_approval: 'Venter godkjenning',
  unverified_commits: 'Uverifiserte commits',
  approved_pr_with_unreviewed: 'PR godkjent med uverifiserte commits',
  direct_push: 'Direkte push',
  legacy: 'Legacy',
  legacy_pending: 'Legacy (venter)',
  repository_mismatch: 'Repository mismatch',
  unauthorized_repository: 'Ikke godkjent repo',
  unauthorized_branch: 'Ikke på godkjent branch',
  error: 'Feil',
  unknown: 'Ukjent',
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a status indicates deployment is approved
 */
export function isApprovedStatus(status: string): boolean {
  return APPROVED_STATUSES.includes(status as FourEyesStatus)
}

/**
 * Check if a status indicates deployment is not approved
 */
export function isNotApprovedStatus(status: string): boolean {
  return NOT_APPROVED_STATUSES.includes(status as FourEyesStatus)
}

/**
 * Check if a status is a legacy status
 */
export function isLegacyStatus(status: string): boolean {
  return LEGACY_STATUSES.includes(status as FourEyesStatus)
}

/**
 * Check if a status is a pending status
 */
export function isPendingStatus(status: string): boolean {
  return PENDING_STATUSES.includes(status as FourEyesStatus)
}

/**
 * Get human-readable label for a status
 */
export function getFourEyesStatusLabel(status: string): string {
  return FOUR_EYES_STATUS_LABELS[status as FourEyesStatus] || status
}
