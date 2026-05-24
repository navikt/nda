/**
 * Tests for the title storage bug fix and detectedTitle precedence.
 *
 * Bug (fixed): store-data.server.ts used `result.deployedPr?.title || result.unverifiedCommits[0]?.message`
 * as the title. When deployedPr was null, this fell back to the first unverified commit message,
 * which could be from a DIFFERENT PR in the compare range — causing wrong titles.
 *
 * Fix: Only use `result.deployedPr?.title || null` as $6. The `detectedTitle` field ($9)
 * provides a correct fallback for non-PR deployments (first commit message from commitsBetween).
 * SQL: `title = COALESCE($6, $9, title)` — PR title wins, then detectedTitle, then preserve existing.
 */
import { describe, expect, it } from 'vitest'
import type { VerificationResult } from '~/lib/verification/types'

/**
 * Simulate the title value that store-data.server.ts passes as $6
 * to the SQL: `title = COALESCE($6, $9, title)`
 */
function getTitleForStorage(result: Pick<VerificationResult, 'deployedPr' | 'unverifiedCommits'>): string | null {
  // This is the FIXED logic (deployedPr?.title only, no fallback to unverifiedCommits)
  return result.deployedPr?.title || null
}

describe('Title storage: no fallback to unverifiedCommits', () => {
  it('uses deployedPr.title when PR is found', () => {
    const result: Pick<VerificationResult, 'deployedPr' | 'unverifiedCommits'> = {
      deployedPr: {
        number: 370,
        url: 'https://github.com/navikt/repo/pull/370',
        title: 'Bump the aksel group with 3 updates',
        author: 'dependabot[bot]',
      },
      unverifiedCommits: [
        {
          sha: 'abc123',
          message: 'Some other commit from different PR',
          author: 'dev',
          date: '2026-01-01',
          htmlUrl: '',
          prNumber: 999,
          reason: 'pr_not_approved',
        },
      ],
    }

    expect(getTitleForStorage(result)).toBe('Bump the aksel group with 3 updates')
  })

  it('returns null when deployedPr is null — does NOT fall back to unverifiedCommits', () => {
    const result: Pick<VerificationResult, 'deployedPr' | 'unverifiedCommits'> = {
      deployedPr: null,
      unverifiedCommits: [
        {
          sha: 'abc123',
          message: 'Commit from a completely different PR',
          author: 'dev',
          date: '2026-01-01',
          htmlUrl: '',
          prNumber: 999,
          reason: 'no_pr',
        },
      ],
    }

    // The old buggy code would return "Commit from a completely different PR"
    // The fix returns null so detectedTitle ($9) or COALESCE keeps the existing title
    expect(getTitleForStorage(result)).toBeNull()
  })

  it('returns null when both deployedPr and unverifiedCommits are empty', () => {
    const result: Pick<VerificationResult, 'deployedPr' | 'unverifiedCommits'> = {
      deployedPr: null,
      unverifiedCommits: [],
    }

    expect(getTitleForStorage(result)).toBeNull()
  })

  it('prefers deployedPr.title over unverifiedCommits even when both exist', () => {
    const result: Pick<VerificationResult, 'deployedPr' | 'unverifiedCommits'> = {
      deployedPr: {
        number: 42,
        url: 'https://github.com/navikt/repo/pull/42',
        title: 'The real PR title',
        author: 'dev',
      },
      unverifiedCommits: [
        {
          sha: 'abc123',
          message: 'A misleading commit message',
          author: 'dev',
          date: '2026-01-01',
          htmlUrl: '',
          prNumber: 99,
          reason: 'pr_not_approved',
        },
      ],
    }

    expect(getTitleForStorage(result)).toBe('The real PR title')
  })
})

describe('Title storage: COALESCE($6, $9, title) behavior', () => {
  /**
   * Simulates `COALESCE($6, $9, title)` — the SQL used in updateDeploymentVerification.
   * $6 = deployedPr?.title, $9 = detectedTitle, title = existing DB value.
   */
  function coalesce(prTitle: string | null, detectedTitle: string | null, existingTitle: string | null): string | null {
    return prTitle ?? detectedTitle ?? existingTitle
  }

  it('preserves existing correct title when both prTitle and detectedTitle are null', () => {
    const existingTitle = 'Correct PR title set by previous verification'
    const newTitle = getTitleForStorage({
      deployedPr: null,
      unverifiedCommits: [
        { sha: 'x', message: 'Wrong commit', author: 'a', date: '', htmlUrl: '', prNumber: null, reason: 'no_pr' },
      ],
    })

    // With the fix, newTitle ($6) is null, and no detectedTitle → COALESCE keeps existing
    expect(coalesce(newTitle, null, existingTitle)).toBe('Correct PR title set by previous verification')
  })

  it('overwrites existing title when deployedPr has a title', () => {
    const existingTitle = 'Old wrong title from a bug'
    const newTitle = getTitleForStorage({
      deployedPr: { number: 1, url: '', title: 'Corrected PR title', author: 'dev' },
      unverifiedCommits: [],
    })

    expect(coalesce(newTitle, null, existingTitle)).toBe('Corrected PR title')
  })

  it('keeps null title when all three are null', () => {
    const existingTitle = null
    const newTitle = getTitleForStorage({ deployedPr: null, unverifiedCommits: [] })

    expect(coalesce(newTitle, null, existingTitle)).toBeNull()
  })

  it('uses detectedTitle as fallback when deployedPr is null', () => {
    const detectedTitle = 'Aktiverer ForsendelsesUtsendelseRouteBuilder.kt igjen for danmark'
    const prTitle = getTitleForStorage({ deployedPr: null, unverifiedCommits: [] })

    // $6 (prTitle) is null, $9 (detectedTitle) provides the value
    expect(coalesce(prTitle, detectedTitle, null)).toBe(detectedTitle)
  })

  it('deployedPr title wins over detectedTitle when both are present', () => {
    const prTitle = getTitleForStorage({
      deployedPr: { number: 5, url: '', title: 'Proper PR title', author: 'dev' },
      unverifiedCommits: [],
    })
    const detectedTitle = 'First commit message fallback'

    // $6 (prTitle) wins — detectedTitle is only used when deployedPr is null
    expect(coalesce(prTitle, detectedTitle, null)).toBe('Proper PR title')
  })

  it('detectedTitle wins over existing DB title when prTitle is null', () => {
    const existingTitle = 'Stale title from a previous failed verification'
    const detectedTitle = 'Fresh commit message title'
    const prTitle = null

    expect(coalesce(prTitle, detectedTitle, existingTitle)).toBe('Fresh commit message title')
  })
})
