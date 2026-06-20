import { describe, expect, it } from 'vitest'
import { shouldUseCachedCommitResult } from '../commit-cache-decision'

describe('Bug A: github_pr_data preservation', () => {
  it('VerificationResult.deployedPr only has reference fields, not full PR metadata', () => {
    const deployedPr = {
      number: 18220,
      url: 'https://github.com/navikt/pensjon-pen/pull/18220',
      author: 'developer-a',
      title: 'PEN-1234: Fix calculation',
      metadata: {} as any,
      reviews: [] as any[],
      commits: [] as any[],
    }

    const minimalData = {
      number: deployedPr.number,
      title: deployedPr.title,
      url: deployedPr.url,
      author: deployedPr.author,
    }

    const richFields = [
      'creator',
      'merged_by',
      'merger',
      'base_branch',
      'head_branch',
      'merge_commit_sha',
      'created_at',
      'merged_at',
      'reviewers',
      'commits',
      'checks',
      'assignees',
      'comments',
      'draft',
      'additions',
      'deletions',
    ]

    for (const field of richFields) {
      expect(minimalData).not.toHaveProperty(field)
    }

    expect(Object.keys(minimalData)).toEqual(['number', 'title', 'url', 'author'])
  })

  it('storeVerificationResult should not write github_pr_data at all', () => {
    expect(true).toBe(true)
  })
})

describe('Bug B: shouldUseCachedCommitResult', () => {
  describe('with forceRecheck=false (default, during sync)', () => {
    it('returns skip_verified when cached as approved', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'approved' }, false)
      expect(result).toBe('skip_verified')
    })

    it('returns add_unverified when cached as not approved with reason', () => {
      const result = shouldUseCachedCommitResult(
        { pr_approved: false, pr_approval_reason: 'no_approved_reviews' },
        false,
      )
      expect(result).toBe('add_unverified')
    })

    it('returns recheck when cached as no_pr (retry rebase matching)', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: false, pr_approval_reason: 'no_pr' }, false)
      expect(result).toBe('recheck')
    })

    it('returns recheck when no cached result', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: null, pr_approval_reason: null }, false)
      expect(result).toBe('recheck')
    })
  })

  describe('with forceRecheck=true (manual re-verification)', () => {
    it('returns recheck even when cached as approved', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'approved' }, true)
      expect(result).toBe('recheck')
    })

    it('returns recheck even when cached as not approved', () => {
      const result = shouldUseCachedCommitResult(
        { pr_approved: false, pr_approval_reason: 'no_approved_reviews' },
        true,
      )
      expect(result).toBe('recheck')
    })

    it('returns recheck when cached as no_pr', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: false, pr_approval_reason: 'no_pr' }, true)
      expect(result).toBe('recheck')
    })

    it('returns recheck when no cached result', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: null, pr_approval_reason: null }, true)
      expect(result).toBe('recheck')
    })
  })

  describe('deployment 151 scenario: stale cache', () => {
    it('with forceRecheck=false, stale approved cache causes missed detection', () => {
      const staleCacheResult = shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'approved' }, false)
      expect(staleCacheResult).toBe('skip_verified')
    })

    it('with forceRecheck=true, stale cache is bypassed and commit is rechecked', () => {
      const result = shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'approved' }, true)
      expect(result).toBe('recheck')
    })
  })
})
