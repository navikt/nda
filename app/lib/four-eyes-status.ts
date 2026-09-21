export const FOUR_EYES_STATUSES = [
  'approved', // PR approved via review
  'approved_pr', // Alias for approved (legacy)
  'implicitly_approved', // Approved via implicit approval rules
  'manually_approved', // Manually approved by admin
  'no_changes', // No changes from previous deployment (same commit SHA)
  'verified_via_sibling', // Same commit SHA already verified via a sibling application's deployment in the same repository (monorepo)
  'pending', // Awaiting verification
  'pending_baseline', // First deployment, awaiting baseline
  'pending_approval', // Alias for pending (legacy)
  'unverified_commits', // Has commits without approved PR
  'approved_pr_with_unreviewed', // Approved PR but has unreviewed commits
  'direct_push', // Direct push to main without PR
  'legacy', // Legacy deployment (before audit)
  'legacy_pending', // Legacy awaiting review
  'unverifiable', // Deployed without repository metadata (e.g. manual kubectl apply) - can never be verified
  'baseline', // First deployment baseline (manually approved)
  'unauthorized_repository', // Repository not approved for this app
  'unauthorized_branch', // Deployed commit not on approved branch
  'missing', // Legacy: PR approval was missing at time of check
  'error', // Error during verification
  'pending_sibling_resolution', // Same commit found on a sibling app's deployment, but that sibling isn't root-approved yet
  'unknown', // Not yet verified (DB default)
] as const

export type FourEyesStatus = (typeof FOUR_EYES_STATUSES)[number]

export const APPROVED_STATUSES: FourEyesStatus[] = [
  'approved',
  'approved_pr',
  'implicitly_approved',
  'manually_approved',
  'no_changes',
  'verified_via_sibling',
  'baseline',
]

export const APPROVED_STATUSES_SQL = APPROVED_STATUSES.map((s) => `'${s}'`).join(', ')

// verified_via_sibling is itself derived, never a valid root — used to gate cross-app
// sibling attribution so a chain of resolutions always traces back to the deployment that
// was actually reviewed, instead of the most recently resolved sibling.
export const ROOT_APPROVED_STATUSES: FourEyesStatus[] = APPROVED_STATUSES.filter(
  (status) => status !== 'verified_via_sibling',
)

export const ROOT_APPROVED_STATUSES_SQL = ROOT_APPROVED_STATUSES.map((s) => `'${s}'`).join(', ')

export const PROPAGATABLE_STATUSES: FourEyesStatus[] = [
  'approved',
  'implicitly_approved',
  'manually_approved',
  'no_changes',
  'verified_via_sibling',
  'approved_pr_with_unreviewed',
]

export const NOT_APPROVED_STATUSES: FourEyesStatus[] = [
  'direct_push',
  'unverified_commits',
  'approved_pr_with_unreviewed',
  'unauthorized_repository',
  'unauthorized_branch',
  'legacy',
  'legacy_pending',
  'unverifiable',
  'missing',
  'error',
]

export const PENDING_STATUSES: FourEyesStatus[] = [
  'pending',
  'pending_baseline',
  'pending_approval',
  'unknown',
  'pending_sibling_resolution',
]

export const REVERIFIABLE_STATUSES: FourEyesStatus[] = [
  'pending',
  'pending_baseline',
  'unknown',
  'pending_sibling_resolution',
]

export const REVERIFIABLE_STATUSES_SQL = REVERIFIABLE_STATUSES.map((s) => `'${s}'`).join(', ')

export const PENDING_STATUSES_SQL = PENDING_STATUSES.map((s) => `'${s}'`).join(', ')

export function notApprovedWhereClause(column: string): string {
  return `COALESCE(${column}, 'unknown') NOT IN (${APPROVED_STATUSES_SQL}) AND COALESCE(${column}, 'unknown') NOT IN (${PENDING_STATUSES_SQL})`
}

export const LEGACY_STATUSES: FourEyesStatus[] = ['legacy', 'legacy_pending']

export const LEGACY_STATUSES_SQL = LEGACY_STATUSES.map((s) => `'${s}'`).join(', ')

// Statuses excluded from commit-diff/baseline-eligibility logic because there is no
// repository to diff against (legacy: pre-audit; unverifiable: missing repo metadata).
export const NON_DIFFABLE_STATUSES: FourEyesStatus[] = [...LEGACY_STATUSES, 'unverifiable']

export const NON_DIFFABLE_STATUSES_SQL = NON_DIFFABLE_STATUSES.map((s) => `'${s}'`).join(', ')

export const UNAUTHORIZED_STATUSES: FourEyesStatus[] = ['unauthorized_repository', 'unauthorized_branch']

export const UNAUTHORIZED_STATUSES_SQL = UNAUTHORIZED_STATUSES.map((s) => `'${s}'`).join(', ')

const PROTECTED_STATUSES: FourEyesStatus[] = ['manually_approved', 'baseline', 'legacy', 'unverifiable']

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
  verified_via_sibling: { tagLabel: 'Verifisert via søskenapplikasjon', tagVariant: 'success' },
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
  unverifiable: { tagLabel: 'Ikke sporbar', tagVariant: 'neutral' },
  missing: { tagLabel: 'Ikke godkjent', tagVariant: 'warning' },
  error: { tagLabel: 'Feil', tagVariant: 'danger' },
  pending_sibling_resolution: { tagLabel: 'Venter på søskenapplikasjon', tagVariant: 'warning' },
  unauthorized_repository: { tagLabel: 'Ikke godkjent repo', tagVariant: 'danger' },
  unauthorized_branch: { tagLabel: 'Ikke på godkjent branch', tagVariant: 'danger' },
}

export const FOUR_EYES_STATUS_LABELS: Record<FourEyesStatus, string> = {
  approved: 'Godkjent',
  approved_pr: 'Godkjent PR',
  implicitly_approved: 'Implisitt godkjent',
  manually_approved: 'Manuelt godkjent',
  no_changes: 'Ingen endringer',
  verified_via_sibling: 'Verifisert via søskenapplikasjon',
  pending: 'Venter',
  pending_baseline: 'Første deployment - venter',
  pending_approval: 'Venter godkjenning',
  unverified_commits: 'Ikke-godkjente commits',
  approved_pr_with_unreviewed: 'PR godkjent med ikke-godkjente commits',
  direct_push: 'Direkte push',
  legacy: 'Legacy',
  legacy_pending: 'Legacy (venter)',
  unverifiable: 'Ikke sporbar (mangler repository-info)',
  baseline: 'Baseline',
  unauthorized_repository: 'Ikke godkjent repo',
  unauthorized_branch: 'Ikke på godkjent branch',
  missing: 'Mangler godkjenning',
  error: 'Feil',
  pending_sibling_resolution: 'Venter på søskenapplikasjon',
  unknown: 'Ukjent',
}

export function isApprovedStatus(status: string): boolean {
  return APPROVED_STATUSES.includes(status as FourEyesStatus)
}

export function isRootApprovedStatus(status: string): boolean {
  return ROOT_APPROVED_STATUSES.includes(status as FourEyesStatus)
}

export function isNotApprovedStatus(status: string): boolean {
  return NOT_APPROVED_STATUSES.includes(status as FourEyesStatus)
}

export function isLegacyStatus(status: string): boolean {
  return LEGACY_STATUSES.includes(status as FourEyesStatus)
}

export function isUnverifiableStatus(status: string): boolean {
  return status === 'unverifiable'
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
