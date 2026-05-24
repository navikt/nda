import { describe, expect, it } from 'vitest'
import {
  APPROVED_STATUSES,
  FOUR_EYES_STATUS_LABELS,
  FOUR_EYES_STATUSES,
  getFourEyesStatusLabel,
  isApprovedStatus,
  isLegacyStatus,
  isNotApprovedStatus,
  isPendingStatus,
  LEGACY_STATUSES,
  NOT_APPROVED_STATUSES,
  PENDING_STATUSES,
} from '../four-eyes-status'

describe('status categorization', () => {
  it('every status belongs to at least one category (approved, not_approved, or pending)', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const inApproved = APPROVED_STATUSES.includes(status)
      const inNotApproved = NOT_APPROVED_STATUSES.includes(status)
      const inPending = PENDING_STATUSES.includes(status)
      expect(inApproved || inNotApproved || inPending, `${status} must be in APPROVED, NOT_APPROVED, or PENDING`).toBe(
        true,
      )
    }
  })

  it('no status appears in more than one primary category', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const count = [APPROVED_STATUSES, NOT_APPROVED_STATUSES, PENDING_STATUSES].filter((cat) =>
        cat.includes(status),
      ).length
      expect(count, `${status} should be in exactly 1 primary category`).toBe(1)
    }
  })

  it('LEGACY_STATUSES is a subset of NOT_APPROVED_STATUSES', () => {
    for (const status of LEGACY_STATUSES) {
      expect(NOT_APPROVED_STATUSES.includes(status), `${status} should be in NOT_APPROVED_STATUSES`).toBe(true)
    }
  })
})

describe('isApprovedStatus', () => {
  it.each([
    'approved',
    'approved_pr',
    'implicitly_approved',
    'manually_approved',
    'no_changes',
  ])('returns true for %s', (status) => {
    expect(isApprovedStatus(status)).toBe(true)
  })

  it.each(['pending', 'direct_push', 'unknown', 'error', 'legacy'])('returns false for %s', (status) => {
    expect(isApprovedStatus(status)).toBe(false)
  })
})

describe('APPROVED_STATUSES completeness', () => {
  it('every status is in approved, not_approved, or pending', () => {
    const categorized = [...APPROVED_STATUSES, ...NOT_APPROVED_STATUSES, ...PENDING_STATUSES]
    for (const status of FOUR_EYES_STATUSES) {
      expect(categorized.includes(status), `${status} must be categorized`).toBe(true)
    }
  })
})

describe('isNotApprovedStatus', () => {
  it.each([
    'direct_push',
    'unverified_commits',
    'approved_pr_with_unreviewed',
    'unauthorized_repository',
    'unauthorized_branch',
    'legacy',
    'legacy_pending',
    'error',
  ])('returns true for %s', (status) => {
    expect(isNotApprovedStatus(status)).toBe(true)
  })

  it('returns false for approved statuses', () => {
    expect(isNotApprovedStatus('approved')).toBe(false)
  })
})

describe('isPendingStatus', () => {
  it.each(['pending', 'pending_baseline', 'pending_approval', 'unknown'])('returns true for %s', (status) => {
    expect(isPendingStatus(status)).toBe(true)
  })

  it('returns false for approved', () => {
    expect(isPendingStatus('approved')).toBe(false)
  })
})

describe('isLegacyStatus', () => {
  it.each(['legacy', 'legacy_pending'])('returns true for %s', (status) => {
    expect(isLegacyStatus(status)).toBe(true)
  })

  it('returns false for non-legacy', () => {
    expect(isLegacyStatus('approved')).toBe(false)
  })
})

describe('getFourEyesStatusLabel', () => {
  it('returns Norwegian label for known statuses', () => {
    expect(getFourEyesStatusLabel('approved')).toBe('Godkjent')
    expect(getFourEyesStatusLabel('pending')).toBe('Venter')
    expect(getFourEyesStatusLabel('direct_push')).toBe('Direkte push')
  })

  it('every status has a label', () => {
    for (const status of FOUR_EYES_STATUSES) {
      expect(FOUR_EYES_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('returns raw string for unknown status', () => {
    expect(getFourEyesStatusLabel('some_new_status')).toBe('some_new_status')
  })
})
