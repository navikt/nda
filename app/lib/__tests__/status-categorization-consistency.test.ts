/**
 * Status Categorization Consistency Tests
 *
 * These tests enforce the "Single Source of Truth" principle for status categorization.
 * All code that asks "is this approved?", "is this pending?", etc. MUST use the
 * canonical helpers from four-eyes-status.ts. These tests verify:
 *
 * 1. Static: No source file defines its own inline status category arrays
 * 2. Semantic: All categorization functions agree on every status value
 *
 * Background: A bug where checkAuditReadiness() defined its own approved-statuses
 * list (missing baseline/no_changes) caused audit report counts to diverge.
 * Audit reports are compliance evidence — this class of bug must be structurally prevented.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APPROVED_STATUSES,
  FOUR_EYES_STATUSES,
  type FourEyesStatus,
  isApprovedStatus,
  isLegacyStatus,
  isNotApprovedStatus,
  isPendingStatus,
  isProtectedStatus,
  LEGACY_STATUSES,
  NOT_APPROVED_STATUSES,
  PENDING_STATUSES,
  REVERIFIABLE_STATUSES,
} from '../four-eyes-status'
import { getFourEyesStatus } from '../status-display'
import { filterDeploymentsForVerification } from '../sync/verify-filters'

// ─── Semantic consistency ────────────────────────────────────────────────────

describe('status categorization semantic consistency', () => {
  // Helper: create a minimal deployment object for a given status
  function makeDeployment(status: FourEyesStatus) {
    return {
      id: 1,
      four_eyes_status: status,
      created_at: new Date().toISOString(),
      commit_sha: 'abc123',
    }
  }

  it('isApprovedStatus agrees with APPROVED_STATUSES for every status', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const helperResult = isApprovedStatus(status)
      const arrayResult = APPROVED_STATUSES.includes(status)
      expect(helperResult, `isApprovedStatus('${status}') disagrees with APPROVED_STATUSES`).toBe(arrayResult)
    }
  })

  it('isPendingStatus agrees with PENDING_STATUSES for every status', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const helperResult = isPendingStatus(status)
      const arrayResult = PENDING_STATUSES.includes(status)
      expect(helperResult, `isPendingStatus('${status}') disagrees with PENDING_STATUSES`).toBe(arrayResult)
    }
  })

  it('isNotApprovedStatus agrees with NOT_APPROVED_STATUSES for every status', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const helperResult = isNotApprovedStatus(status)
      const arrayResult = NOT_APPROVED_STATUSES.includes(status)
      expect(helperResult, `isNotApprovedStatus('${status}') disagrees with NOT_APPROVED_STATUSES`).toBe(arrayResult)
    }
  })

  it('isLegacyStatus agrees with LEGACY_STATUSES for every status', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const helperResult = isLegacyStatus(status)
      const arrayResult = LEGACY_STATUSES.includes(status)
      expect(helperResult, `isLegacyStatus('${status}') disagrees with LEGACY_STATUSES`).toBe(arrayResult)
    }
  })

  it('getFourEyesStatus display returns success variant for all approved statuses', () => {
    for (const status of APPROVED_STATUSES) {
      const display = getFourEyesStatus({ four_eyes_status: status })
      expect(
        display.variant,
        `Display for approved status '${status}' should be 'success', got '${display.variant}'`,
      ).toBe('success')
    }
  })

  it('filterDeploymentsForVerification excludes all approved statuses', () => {
    for (const status of APPROVED_STATUSES) {
      const deployments = [makeDeployment(status)]
      const filtered = filterDeploymentsForVerification(deployments)
      expect(filtered.length, `Approved status '${status}' should be filtered out`).toBe(0)
    }
  })

  it('filterDeploymentsForVerification includes all reverifiable statuses', () => {
    for (const status of REVERIFIABLE_STATUSES) {
      const deployments = [makeDeployment(status)]
      const filtered = filterDeploymentsForVerification(deployments)
      expect(filtered.length, `Reverifiable status '${status}' should be included for verification`).toBe(1)
    }
  })

  it('filterDeploymentsForVerification excludes pending_approval (awaiting human review)', () => {
    const deployments = [makeDeployment('pending_approval')]
    const filtered = filterDeploymentsForVerification(deployments)
    expect(filtered.length, `'pending_approval' should not be auto-verified`).toBe(0)
  })

  it('filterDeploymentsForVerification excludes finalized legacy status', () => {
    const deployments = [makeDeployment('legacy')]
    const filtered = filterDeploymentsForVerification(deployments)
    expect(filtered.length, `Finalized 'legacy' should be excluded from verification`).toBe(0)
  })

  it('approved + not_approved + pending covers all statuses without overlap', () => {
    for (const status of FOUR_EYES_STATUSES) {
      const categories = [
        isApprovedStatus(status) ? 'approved' : null,
        isNotApprovedStatus(status) ? 'not_approved' : null,
        isPendingStatus(status) ? 'pending' : null,
      ].filter(Boolean)

      expect(categories.length, `'${status}' must be in exactly one primary category, found: ${categories}`).toBe(1)
    }
  })

  it('isProtectedStatus is a subset of approved + not_approved (never pending)', () => {
    for (const status of FOUR_EYES_STATUSES) {
      if (isProtectedStatus(status)) {
        expect(isPendingStatus(status), `Protected status '${status}' should not be pending`).toBe(false)
      }
    }
  })

  it('REVERIFIABLE_STATUSES is a strict subset of PENDING_STATUSES', () => {
    for (const status of REVERIFIABLE_STATUSES) {
      expect(
        PENDING_STATUSES.includes(status),
        `Reverifiable status '${status}' must also be in PENDING_STATUSES`,
      ).toBe(true)
    }
  })

  it('REVERIFIABLE_STATUSES excludes pending_approval', () => {
    expect(REVERIFIABLE_STATUSES).not.toContain('pending_approval')
  })
})

// ─── Static analysis: no inline status category definitions ──────────────────

describe('no inline status category definitions in source files', () => {
  const excludePatterns = [
    '__tests__',
    '__stories__',
    'node_modules',
    'four-eyes-status.ts', // The canonical source — obviously defines these
    'status-display.ts', // Switch on individual statuses for display (not categorization)
  ]

  function grepForPattern(pattern: string): string[] {
    // Use a validated, hardcoded relative path to avoid shell injection (CodeQL).
    // __dirname is always inside app/lib/__tests__, so '../..' resolves to app/.
    const safeDir = path.resolve(__dirname, '../..')
    const excludeArgs = excludePatterns.map((p) => ` | grep -v '${p}'`).join('')
    try {
      const result = execSync(`grep -rn --include='*.ts' --include='*.tsx' -E '${pattern}' .${excludeArgs}`, {
        encoding: 'utf-8',
        timeout: 10000,
        cwd: safeDir,
      })
      return result.trim().split('\n').filter(Boolean)
    } catch (error: unknown) {
      // grep exits with code 1 when no matches found — that's expected
      if (error instanceof Error && 'status' in error && (error as { status: number }).status === 1) {
        return []
      }
      // Any other error (grep missing, timeout, etc.) should fail the test
      throw error
    }
  }

  it('no file defines a local PENDING_STATUSES constant', () => {
    const matches = grepForPattern('(const|let|var)[[:space:]]+PENDING_STATUSES[[:space:]]*[=:]')
    expect(
      matches,
      `Found local PENDING_STATUSES definitions (must use canonical import):\n${matches.join('\n')}`,
    ).toHaveLength(0)
  })

  it('no file defines a local APPROVED_STATUSES constant', () => {
    const matches = grepForPattern('(const|let|var)[[:space:]]+APPROVED_STATUSES[[:space:]]*[=:]')
    expect(
      matches,
      `Found local APPROVED_STATUSES definitions (must use canonical import):\n${matches.join('\n')}`,
    ).toHaveLength(0)
  })

  it('no file defines a local approvedStatuses variable', () => {
    const matches = grepForPattern('(const|let|var)[[:space:]]+approvedStatuses[[:space:]]*[=:]')
    expect(
      matches,
      `Found local approvedStatuses definitions (must use canonical import):\n${matches.join('\n')}`,
    ).toHaveLength(0)
  })

  it('no file defines a local NOT_APPROVED_STATUSES constant', () => {
    const matches = grepForPattern('(const|let|var)[[:space:]]+NOT_APPROVED_STATUSES[[:space:]]*[=:]')
    expect(
      matches,
      `Found local NOT_APPROVED_STATUSES definitions (must use canonical import):\n${matches.join('\n')}`,
    ).toHaveLength(0)
  })
})
