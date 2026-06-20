import { describe, expect, it } from 'vitest'
import type { PrCommit, PrReview } from '../verification/types'
import { verifyFourEyesFromPrData } from '../verification/verify'

function makeCommit(overrides: Partial<PrCommit> = {}): PrCommit {
  return {
    sha: 'abc1234',
    message: 'feat: something',
    authorUsername: 'alice',
    authorDate: '2026-01-15T10:00:00Z',
    committerDate: '2026-01-15T10:00:00Z',
    isMergeCommit: false,
    parentShas: ['parent1'],
    ...overrides,
  }
}

function makeReview(overrides: Partial<PrReview> = {}): PrReview {
  return {
    id: 1,
    username: 'bob',
    state: 'APPROVED',
    submittedAt: '2026-01-15T12:00:00Z',
    body: null,
    ...overrides,
  }
}

describe('verifyFourEyesFromPrData — helper logic', () => {
  describe('extractApprovers behavior (via result reason)', () => {
    it('includes approver username in reason', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makeReview({ username: 'reviewer-jane' })],
        commits: [makeCommit()],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('reviewer-jane')
    })

    it('uses first approver when multiple exist', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [
          makeReview({ id: 1, username: 'first', submittedAt: '2026-01-15T12:00:00Z' }),
          makeReview({ id: 2, username: 'second', submittedAt: '2026-01-15T13:00:00Z' }),
        ],
        commits: [makeCommit()],
        baseBranch: 'main',
      })
      expect(result.reason).toContain('first')
    })
  })

  describe('getLastCommitAuthor behavior', () => {
    it('uses the last commit for date comparison', () => {
      const earlyCommit = makeCommit({
        sha: 'early',
        authorDate: '2026-01-10T10:00:00Z',
        committerDate: '2026-01-10T10:00:00Z',
      })
      const lateCommit = makeCommit({
        sha: 'late',
        authorDate: '2026-01-15T10:00:00Z',
        committerDate: '2026-01-15T10:00:00Z',
      })
      const review = makeReview({ submittedAt: '2026-01-12T10:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [earlyCommit, lateCommit],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('approval_before_last_commit')
    })
  })

  describe('latestCommitDate behavior', () => {
    it('uses committerDate when later than authorDate (prevents backdating)', () => {
      const commit = makeCommit({
        authorDate: '2026-01-10T10:00:00Z',
        committerDate: '2026-01-15T10:00:00Z', // Later
      })
      const review = makeReview({ submittedAt: '2026-01-12T10:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [commit],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
    })

    it('uses authorDate when later than committerDate', () => {
      const commit = makeCommit({
        authorDate: '2026-01-15T10:00:00Z', // Later
        committerDate: '2026-01-10T10:00:00Z',
      })
      const review = makeReview({ submittedAt: '2026-01-12T10:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [commit],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
    })

    it('passes when review is after both dates', () => {
      const commit = makeCommit({
        authorDate: '2026-01-15T10:00:00Z',
        committerDate: '2026-01-14T10:00:00Z',
      })
      const review = makeReview({ submittedAt: '2026-01-16T10:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [commit],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(true)
    })
  })

  describe('base branch merge commit skipping', () => {
    it('ignores trailing base merge commits when finding last real commit', () => {
      const realCommit = makeCommit({
        sha: 'real',
        authorDate: '2026-01-14T10:00:00Z',
        committerDate: '2026-01-14T10:00:00Z',
      })
      const mergeCommit = makeCommit({
        sha: 'merge',
        message: "Merge branch 'main' into feature-x",
        authorDate: '2026-01-15T10:00:00Z',
        committerDate: '2026-01-15T10:00:00Z',
        isMergeCommit: true,
      })
      const review = makeReview({ submittedAt: '2026-01-14T12:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [realCommit, mergeCommit],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('ignoring 1 base-merge commit')
    })
  })

  describe('merger validates four-eyes', () => {
    it('passes when merger is not a commit author (stale approval)', () => {
      const commit = makeCommit({
        authorUsername: 'alice',
        authorDate: '2026-01-15T10:00:00Z',
        committerDate: '2026-01-15T10:00:00Z',
      })
      const review = makeReview({ submittedAt: '2026-01-14T10:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [commit],
        baseBranch: 'main',
        mergedBy: 'charlie',
      })
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('merged by charlie')
    })

    it('fails when merger is also a commit author', () => {
      const commit = makeCommit({
        authorUsername: 'alice',
        authorDate: '2026-01-15T10:00:00Z',
        committerDate: '2026-01-15T10:00:00Z',
      })
      const review = makeReview({ submittedAt: '2026-01-14T10:00:00Z' })

      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: [commit],
        baseBranch: 'main',
        mergedBy: 'alice',
      })
      expect(result.hasFourEyes).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('returns false for empty commits', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makeReview()],
        commits: [],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toContain('No commits')
    })

    it('returns false with no reviews', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [],
        commits: [makeCommit()],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('no_approved_reviews')
    })

    it('ignores non-APPROVED reviews', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [
          makeReview({ state: 'COMMENTED', submittedAt: '2026-01-16T10:00:00Z' }),
          makeReview({ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-16T10:00:00Z' }),
        ],
        commits: [makeCommit()],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
    })
  })
})
