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
  'unauthorized_repository', // Repository not approved for this app
  'unauthorized_branch', // Deployed commit not on approved branch
  'missing', // Legacy: PR approval was missing at time of check
  'error', // Error during verification
  'unknown', // Not yet verified (DB default)
] as const

export type FourEyesStatus = (typeof FOUR_EYES_STATUSES)[number]

export const APPROVED_STATUSES: FourEyesStatus[] = [
  'approved',
  'approved_pr',
  'implicitly_approved',
  'manually_approved',
  'no_changes',
  'baseline',
]

export const APPROVED_STATUSES_SQL = APPROVED_STATUSES.map((s) => `'${s}'`).join(', ')

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
]

export const PENDING_STATUSES: FourEyesStatus[] = ['pending', 'pending_baseline', 'pending_approval', 'unknown']

export const REVERIFIABLE_STATUSES: FourEyesStatus[] = ['pending', 'pending_baseline', 'unknown']

export const PENDING_STATUSES_SQL = PENDING_STATUSES.map((s) => `'${s}'`).join(', ')

export function notApprovedWhereClause(column: string): string {
  return `COALESCE(${column}, 'unknown') NOT IN (${APPROVED_STATUSES_SQL}) AND COALESCE(${column}, 'unknown') NOT IN (${PENDING_STATUSES_SQL})`
}

export const LEGACY_STATUSES: FourEyesStatus[] = ['legacy', 'legacy_pending']

export const LEGACY_STATUSES_SQL = LEGACY_STATUSES.map((s) => `'${s}'`).join(', ')

const PROTECTED_STATUSES: FourEyesStatus[] = ['manually_approved', 'baseline', 'legacy']

export const PROTECTED_STATUSES_SQL = PROTECTED_STATUSES.map((s) => `'${s}'`).join(', ')

export const STATUS_DISPLAY: Record<
  FourEyesStatus,
  { tagLabel: string; tagVariant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  approved: { tagLabel: 'Godkjent', tagVariant: 'success' },
  approved_pr: { tagLabel: 'Godkjent', tagVariant: 'success' },
  implicitly_approved: { tagLabel: 'Godkjent', tagVariant: 'success' },
  manually_approved: { tagLabel: 'Godkjent', tagVariant: 'success' },
  no_changes: { tagLabel: 'Godkjent', tagVariant: 'success' },
  baseline: { tagLabel: 'Godkjent', tagVariant: 'success' },
  pending: { tagLabel: 'Venter', tagVariant: 'neutral' },
  pending_baseline: { tagLabel: 'Foreslått baseline', tagVariant: 'warning' },
  pending_approval: { tagLabel: 'Venter', tagVariant: 'neutral' },
  unknown: { tagLabel: 'Venter', tagVariant: 'neutral' },
  direct_push: { tagLabel: 'Ikke godkjent', tagVariant: 'warning' },
  unverified_commits: { tagLabel: 'Ikke godkjent', tagVariant: 'warning' },
  approved_pr_with_unreviewed: { tagLabel: 'Ureviewed', tagVariant: 'warning' },
  legacy: { tagLabel: 'Legacy', tagVariant: 'neutral' },
  legacy_pending: { tagLabel: 'Legacy', tagVariant: 'neutral' },
  missing: { tagLabel: 'Ikke godkjent', tagVariant: 'warning' },
  error: { tagLabel: 'Feil', tagVariant: 'danger' },
  unauthorized_repository: { tagLabel: 'Ikke godkjent repo', tagVariant: 'danger' },
  unauthorized_branch: { tagLabel: 'Ikke på godkjent branch', tagVariant: 'danger' },
}

export const FOUR_EYES_STATUS_LABELS: Record<FourEyesStatus, string> = {
  approved: 'Godkjent',
  approved_pr: 'Godkjent PR',
  implicitly_approved: 'Implisitt godkjent',
  manually_approved: 'Manuelt godkjent',
  no_changes: 'Ingen endringer',
  pending: 'Venter',
  pending_baseline: 'Første deployment - venter',
  pending_approval: 'Venter godkjenning',
  unverified_commits: 'Ikke-godkjente commits',
  approved_pr_with_unreviewed: 'PR godkjent med ikke-godkjente commits',
  direct_push: 'Direkte push',
  legacy: 'Legacy',
  legacy_pending: 'Legacy (venter)',
  baseline: 'Baseline',
  unauthorized_repository: 'Ikke godkjent repo',
  unauthorized_branch: 'Ikke på godkjent branch',
  missing: 'Mangler godkjenning',
  error: 'Feil',
  unknown: 'Ukjent',
}

export function isApprovedStatus(status: string): boolean {
  return APPROVED_STATUSES.includes(status as FourEyesStatus)
}

export function isNotApprovedStatus(status: string): boolean {
  return NOT_APPROVED_STATUSES.includes(status as FourEyesStatus)
}

export function isLegacyStatus(status: string): boolean {
  return LEGACY_STATUSES.includes(status as FourEyesStatus)
}

export function isPendingStatus(status: string): boolean {
  return PENDING_STATUSES.includes(status as FourEyesStatus)
}

export function isProtectedStatus(status: string): boolean {
  return PROTECTED_STATUSES.includes(status as FourEyesStatus)
}

export function getFourEyesStatusLabel(status: string): string {
  return FOUR_EYES_STATUS_LABELS[status as FourEyesStatus] || status
}
