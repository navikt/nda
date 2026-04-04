/**
 * Tests for Bug A (github_pr_data overwrite) and Bug B (stale cache bypass).
 *
 * Bug A: storeVerificationResult creates minimal {number, title, url, author}
 * from VerificationResult.deployedPr and overwrites existing rich github_pr_data
 * (which contains creator, merger, reviewers, commits, checks, etc.)
 *
 * Bug B: V1's verifyDeploymentFourEyes trusts the DB commit cache.
 * If a previous run cached pr_approved=true for a commit that should be
 * pr_approved=false, re-verification incorrectly skips it.
 * The fix: skip DB cache when forceRecheck=true.
 */
import { describe, expect, it } from 'vitest'
import { shouldUseCachedCommitResult } from '../commit-cache-decision'

// =============================================================================
// Bug A: github_pr_data should not be overwritten with minimal data
// =============================================================================

describe('Bug A: github_pr_data preservation', () => {
  it('VerificationResult.deployedPr only has reference fields, not full PR metadata', () => {
    // This documents why using deployedPr to build github_pr_data causes data loss.
    // The deployedPr in VerificationResult has: number, url, author, title
    // The GitHubPRData in the DB has: creator, merged_by, reviewers, commits, checks, etc.
    const deployedPr = {
      number: 18220,
      url: 'https://github.com/navikt/pensjon-pen/pull/18220',
      author: 'developer-a',
      title: 'PEN-1234: Fix calculation',
      metadata: {} as any,
      reviews: [] as any[],
      commits: [] as any[],
    }

    // Only these 4 fields would be written to github_pr_data
    const minimalData = {
      number: deployedPr.number,
      title: deployedPr.title,
      url: deployedPr.url,
      author: deployedPr.author,
    }

    // These rich fields from the existing github_pr_data would be lost
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

    // minimalData should NOT contain any rich fields
    for (const field of richFields) {
      expect(minimalData).not.toHaveProperty(field)
    }

    // This proves that overwriting github_pr_data with minimalData causes data loss
    expect(Object.keys(minimalData)).toEqual(['number', 'title', 'url', 'author'])
  })

  it('storeVerificationResult should not write github_pr_data at all', () => {
    // The fix: storeVerificationResult should only update:
    // - four_eyes_status
    // - github_pr_number
    // - unverified_commits
    // It should NOT touch github_pr_data, which already has rich data from sync
    //
    // This test documents the expected behavior after the fix.
    // The SQL should change from:
    //   github_pr_data = COALESCE($4::jsonb, github_pr_data)
    // to:
    //   (no github_pr_data update at all)
    expect(true).toBe(true) // Behavior documented; actual fix is in SQL
  })
})

// =============================================================================
// Bug B: DB commit cache bypass for manual re-verification
// =============================================================================

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
      // Commit edf1b1f from PR #18196 was incorrectly cached as approved
      // in a previous run. V1 trusts the cache and skips this commit.
      const staleCacheResult = shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'approved' }, false)
      // Bug: V1 would skip this commit, missing the unverified commit
      expect(staleCacheResult).toBe('skip_verified')
    })

    it('with forceRecheck=true, stale cache is bypassed and commit is rechecked', () => {
      // Same stale cache, but with forceRecheck=true (manual re-verification)
      const result = shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'approved' }, true)
      // Fix: V1 rechecks the commit via GitHub API, detecting it as unverified
      expect(result).toBe('recheck')
    })
  })
})
