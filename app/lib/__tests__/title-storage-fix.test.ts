import { describe, expect, it } from 'vitest'
import type { VerificationResult } from '~/lib/verification/types'

function getTitleForStorage(result: Pick<VerificationResult, 'deployedPr' | 'unverifiedCommits'>): string | null {
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

    expect(coalesce(prTitle, detectedTitle, null)).toBe(detectedTitle)
  })

  it('deployedPr title wins over detectedTitle when both are present', () => {
    const prTitle = getTitleForStorage({
      deployedPr: { number: 5, url: '', title: 'Proper PR title', author: 'dev' },
      unverifiedCommits: [],
    })
    const detectedTitle = 'First commit message fallback'

    expect(coalesce(prTitle, detectedTitle, null)).toBe('Proper PR title')
  })

  it('detectedTitle wins over existing DB title when prTitle is null', () => {
    const existingTitle = 'Stale title from a previous failed verification'
    const detectedTitle = 'Fresh commit message title'
    const prTitle = null

    expect(coalesce(prTitle, detectedTitle, existingTitle)).toBe('Fresh commit message title')
  })
})
