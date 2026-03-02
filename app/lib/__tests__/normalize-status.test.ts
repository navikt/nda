import { describe, expect, it } from 'vitest'
import { normalizeStatus } from '../verification/compute-diffs.server'

/**
 * Tests for verification status normalization.
 *
 * WHY: The verification diff system compares old (stored) status with newly computed status.
 * Some statuses are equivalent (approved_pr ≡ approved, pending_approval ≡ pending).
 * If this normalization is wrong, the diff system reports false positives ("status changed!")
 * when nothing actually changed, or misses real changes. This creates noise in the
 * verification dashboard that undermines trust in the tool.
 */

describe('normalizeStatus — maps equivalent statuses to canonical form for diff comparison', () => {
  it('normalizes approved_pr → approved (same meaning, different name)', () => {
    expect(normalizeStatus('approved_pr')).toBe('approved')
  })

  it('normalizes pending_approval → pending (same meaning, different name)', () => {
    expect(normalizeStatus('pending_approval')).toBe('pending')
  })

  it('passes through statuses without equivalence unchanged', () => {
    expect(normalizeStatus('approved')).toBe('approved')
    expect(normalizeStatus('pending')).toBe('pending')
    expect(normalizeStatus('error')).toBe('error')
    expect(normalizeStatus('missing')).toBe('missing')
    expect(normalizeStatus('direct_push')).toBe('direct_push')
    expect(normalizeStatus('baseline')).toBe('baseline')
    expect(normalizeStatus('unverified_commits')).toBe('unverified_commits')
    expect(normalizeStatus('manually_approved')).toBe('manually_approved')
    expect(normalizeStatus('legacy')).toBe('legacy')
  })

  it('returns null for null input (no status set)', () => {
    expect(normalizeStatus(null)).toBeNull()
  })

  it('returns unknown status as-is (forward-compatible with new statuses)', () => {
    expect(normalizeStatus('some_future_status')).toBe('some_future_status')
  })
})
