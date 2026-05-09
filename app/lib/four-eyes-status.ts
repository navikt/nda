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
  'baseline', // First deployment baseline (manually approved)
  'repository_mismatch', // Repository doesn't match monitored app
  'unauthorized_repository', // Repository not approved for this app
  'unauthorized_branch', // Deployed commit not on approved branch
  'missing', // Legacy: PR approval was missing at time of check
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
  'baseline',
]

/**
 * SQL fragment for filtering approved deployments.
 * Use in place of `has_four_eyes = true`.
 */
export const APPROVED_STATUSES_SQL = APPROVED_STATUSES.map((s) => `'${s}'`).join(', ')

/**
 * Statuses that indicate deployment is NOT approved.
 * Includes legacy and error statuses — these are not four-eyes verified
 * and must be visible as failures in stats and app cards.
 */
export const NOT_APPROVED_STATUSES: FourEyesStatus[] = [
  'direct_push',
  'unverified_commits',
  'approved_pr_with_unreviewed',
  'unauthorized_repository',
  'unauthorized_branch',
  'legacy',
  'legacy_pending',
  'missing',
  'error',
  'repository_mismatch',
]

/**
 * Statuses that indicate deployment is pending verification
 */
export const PENDING_STATUSES: FourEyesStatus[] = ['pending', 'pending_baseline', 'pending_approval', 'unknown']

/**
 * Statuses eligible for automatic re-verification by the background verifier.
 * Excludes `pending_approval` which represents a manual registration explicitly
 * awaiting human review — the verifier must not overwrite that workflow.
 */
export const REVERIFIABLE_STATUSES: FourEyesStatus[] = ['pending', 'pending_baseline', 'unknown']

/**
 * SQL fragment for filtering pending deployments.
 */
export const PENDING_STATUSES_SQL = PENDING_STATUSES.map((s) => `'${s}'`).join(', ')

/**
 * SQL WHERE clause fragment that matches deployments considered "not approved".
 * Uses exclusion logic: anything NOT in APPROVED and NOT in PENDING is "not approved".
 * This is consistent with the remainder-based derivation in stats queries.
 *
 * @param column - The column expression, e.g. 'd.four_eyes_status'
 */
export function notApprovedWhereClause(column: string): string {
  return `COALESCE(${column}, 'unknown') NOT IN (${APPROVED_STATUSES_SQL}) AND COALESCE(${column}, 'unknown') NOT IN (${PENDING_STATUSES_SQL})`
}

/**
 * Statuses that indicate legacy deployments
 */
export const LEGACY_STATUSES: FourEyesStatus[] = ['legacy', 'legacy_pending']

/**
 * SQL fragment for filtering legacy deployments.
 */
export const LEGACY_STATUSES_SQL = LEGACY_STATUSES.map((s) => `'${s}'`).join(', ')

/**
 * Statuses protected from re-verification overwrite.
 * These represent explicit admin decisions that automated verification must not change.
 */
const PROTECTED_STATUSES: FourEyesStatus[] = ['manually_approved', 'baseline', 'legacy']

/**
 * SQL fragment for filtering protected statuses.
 */
export const PROTECTED_STATUSES_SQL = PROTECTED_STATUSES.map((s) => `'${s}'`).join(', ')

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
  pending_baseline: 'Første deployment - venter',
  pending_approval: 'Venter godkjenning',
  unverified_commits: 'Uverifiserte commits',
  approved_pr_with_unreviewed: 'PR godkjent med uverifiserte commits',
  direct_push: 'Direkte push',
  legacy: 'Legacy',
  legacy_pending: 'Legacy (venter)',
  baseline: 'Baseline',
  repository_mismatch: 'Repository mismatch',
  unauthorized_repository: 'Ikke godkjent repo',
  unauthorized_branch: 'Ikke på godkjent branch',
  missing: 'Mangler godkjenning',
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
 * Check if a status is protected from re-verification overwrite.
 * Protected statuses represent explicit admin decisions.
 */
export function isProtectedStatus(status: string): boolean {
  return PROTECTED_STATUSES.includes(status as FourEyesStatus)
}

/**
 * Get human-readable label for a status
 */
export function getFourEyesStatusLabel(status: string): string {
  return FOUR_EYES_STATUS_LABELS[status as FourEyesStatus] || status
}
