import { describe, expect, it } from 'vitest'
import type { PrCommit, PrReview, VerificationInput } from '../verification/types'
import { verifyDeployment, verifyFourEyesFromPrData } from '../verification/verify'

/**
 * Tests for unverified commit reason codes.
 *
 * V1 verification (sync.server.ts) must detect unverified commits with the
 * same granular reason codes as V2 (verify.ts). These tests exercise V2's
 * verifyDeployment and verifyFourEyesFromPrData to define the expected
 * behavior that V1 must match after refactoring.
 *
 * Key reason codes:
 * - 'no_pr': Commit has no associated pull request (direct push)
 * - 'no_approved_reviews': PR exists but has zero approved reviews
 * - 'approval_before_last_commit': PR has approvals but all before last commit
 * - 'pr_not_approved': Generic fallback (PR not approved for other reasons)
 *
 * Based on real deployment 151 scenario where V1 produced 'approved' status
 * while V2 correctly found 3 unverified commits with specific reasons.
 */

// =============================================================================
// Test Helpers
// =============================================================================

function makePrCommit(overrides: Partial<PrCommit> = {}): PrCommit {
  return {
    sha: 'default-commit-sha',
    message: 'Default commit message',
    authorUsername: 'developer-a',
    authorDate: '2026-01-25T12:00:00Z',
    committerDate: '2026-01-25T12:00:00Z',
    isMergeCommit: false,
    parentShas: [],
    ...overrides,
  }
}

function makePrReview(overrides: Partial<PrReview> = {}): PrReview {
  return {
    id: 1,
    username: 'reviewer-b',
    state: 'APPROVED',
    submittedAt: '2026-01-26T14:00:00Z',
    body: null,
    ...overrides,
  }
}

function makeBaseInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    deploymentId: 151,
    commitSha: 'deploy-sha-151',
    repository: 'navikt/pensjon-pen',
    environmentName: 'prod-fss',
    baseBranch: 'main',
    repositoryStatus: 'active',
    commitOnBaseBranch: true,
    auditStartYear: 2025,
    implicitApprovalSettings: { mode: 'off' },
    previousDeployment: {
      id: 150,
      commitSha: 'deploy-sha-150',
      createdAt: '2026-01-24T10:00:00Z',
    },
    deployedPr: null,
    commitsBetween: [],
    compareSummary: null,
    dataFreshness: {
      deployedPrFetchedAt: new Date('2026-02-28T10:00:00Z'),
      commitsFetchedAt: new Date('2026-02-28T10:00:00Z'),
      schemaVersion: 1,
    },
    ...overrides,
  }
}

// =============================================================================
// verifyFourEyesFromPrData — reason code tests
// =============================================================================

describe('verifyFourEyesFromPrData - reason codes for V1 consistency', () => {
  it('should return "no_approved_reviews" when PR has no reviews', () => {
    const result = verifyFourEyesFromPrData({
      reviewers: [],
      commits: [makePrCommit()],
      baseBranch: 'main',
    })

    expect(result.hasFourEyes).toBe(false)
    expect(result.reason).toBe('no_approved_reviews')
  })

  it('should return "no_approved_reviews" when PR has only COMMENTED reviews', () => {
    const result = verifyFourEyesFromPrData({
      reviewers: [makePrReview({ state: 'COMMENTED' }), makePrReview({ state: 'CHANGES_REQUESTED' })],
      commits: [makePrCommit()],
      baseBranch: 'main',
    })

    expect(result.hasFourEyes).toBe(false)
    expect(result.reason).toBe('no_approved_reviews')
  })

  it('should return "approval_before_last_commit" when approval is before last commit', () => {
    const result = verifyFourEyesFromPrData({
      reviewers: [makePrReview({ submittedAt: '2026-01-25T11:00:00Z' })],
      commits: [
        makePrCommit({ authorDate: '2026-01-25T10:00:00Z' }),
        makePrCommit({ authorDate: '2026-01-25T12:00:00Z' }),
      ],
      baseBranch: 'main',
    })

    expect(result.hasFourEyes).toBe(false)
    expect(result.reason).toBe('approval_before_last_commit')
  })

  it('should NOT return generic "pr_not_approved" for no-reviews case', () => {
    const result = verifyFourEyesFromPrData({
      reviewers: [],
      commits: [makePrCommit()],
      baseBranch: 'main',
    })

    // V1 bug: returns 'No approved reviews found' which maps to 'pr_not_approved'
    // via mapToUnverifiedReason. Should be 'no_approved_reviews'.
    expect(result.reason).not.toBe('pr_not_approved')
    expect(result.reason).not.toBe('No approved reviews found')
  })

  it('should NOT return generic "pr_not_approved" for approval-before-commit case', () => {
    const result = verifyFourEyesFromPrData({
      reviewers: [makePrReview({ submittedAt: '2026-01-25T11:00:00Z' })],
      commits: [makePrCommit({ authorDate: '2026-01-25T12:00:00Z' })],
      baseBranch: 'main',
    })

    // V1 bug: returns 'Approval was before last commit' which maps to 'pr_not_approved'
    // via mapToUnverifiedReason. Should be 'approval_before_last_commit'.
    expect(result.reason).not.toBe('pr_not_approved')
    expect(result.reason).not.toBe('Approval was before last commit')
  })
})

// =============================================================================
// verifyDeployment — deployment 151 scenario
// =============================================================================

describe('verifyDeployment - deployment 151 (unapproved PR + direct push)', () => {
  /**
   * Reproduces the real deployment 151 scenario:
   * - Commits edf1b1f and 16708b8 are from PR #18196 which has NO approved reviews
   * - Commit 55a83e7 is a direct push revert (no PR)
   * - The deployed PR #18220 is approved
   *
   * V1 originally reported 'approved' for this deployment (bug).
   * V2 correctly found 3 unverified commits with specific reasons.
   */

  const deployment151Input = makeBaseInput({
    deployedPr: {
      number: 18220,
      url: 'https://github.com/navikt/pensjon-pen/pull/18220',
      metadata: {
        number: 18220,
        title: 'Feature: Approved changes',
        body: null,
        state: 'closed',
        merged: true,
        draft: false,
        createdAt: '2026-01-26T08:00:00Z',
        updatedAt: '2026-01-26T11:00:00Z',
        mergedAt: '2026-01-26T11:00:00Z',
        closedAt: '2026-01-26T11:00:00Z',
        baseBranch: 'main',
        baseSha: 'base-sha',
        headBranch: 'feature/approved',
        headSha: 'head-sha-18220',
        mergeCommitSha: 'deploy-sha-151',
        author: { username: 'user-b' },
        mergedBy: { username: 'reviewer-c' },
        labels: [],
        commitsCount: 2,
        changedFiles: 5,
        additions: 50,
        deletions: 10,
      },
      reviews: [
        makePrReview({
          username: 'reviewer-c',
          submittedAt: '2026-01-26T10:50:00Z',
        }),
      ],
      commits: [
        makePrCommit({
          sha: 'e9ba01f37fdde990718fbdc66ae3713a392f7a2e',
          message: 'Commit in approved PR',
          authorUsername: 'user-b',
          authorDate: '2026-01-26T09:00:00Z',
        }),
        makePrCommit({
          sha: 'dbcb7c23209a5db6236dbdf50b6e1abe341002b5',
          message: 'Another commit in approved PR',
          authorUsername: 'user-b',
          authorDate: '2026-01-26T09:30:00Z',
        }),
      ],
    },
    commitsBetween: [
      // Commits from unapproved PR #18196
      {
        sha: 'edf1b1ff84ae3e508fa989c189a62ecbf44dd5aa',
        message: 'Feature commit from unapproved PR',
        authorUsername: 'user-a',
        authorDate: '2026-01-25T10:00:00Z',
        isMergeCommit: false,
        parentShas: ['parent-1'],
        htmlUrl: 'https://github.com/navikt/pensjon-pen/commit/edf1b1f',
        pr: {
          number: 18196,
          title: 'Feature: Unapproved changes',
          url: 'https://github.com/navikt/pensjon-pen/pull/18196',
          reviews: [], // No reviews!
          commits: [
            makePrCommit({
              sha: 'edf1b1ff84ae3e508fa989c189a62ecbf44dd5aa',
              authorUsername: 'user-a',
              authorDate: '2026-01-25T10:00:00Z',
            }),
            makePrCommit({
              sha: '16708b817e1d16f34168b1f79d62e54aa5941592',
              authorUsername: 'user-a',
              authorDate: '2026-01-25T10:30:00Z',
            }),
          ],
          baseBranch: 'main',
        },
      },
      {
        sha: '16708b817e1d16f34168b1f79d62e54aa5941592',
        message: 'Another commit from unapproved PR',
        authorUsername: 'user-a',
        authorDate: '2026-01-25T10:30:00Z',
        isMergeCommit: false,
        parentShas: ['parent-2'],
        htmlUrl: 'https://github.com/navikt/pensjon-pen/commit/16708b8',
        pr: {
          number: 18196,
          title: 'Feature: Unapproved changes',
          url: 'https://github.com/navikt/pensjon-pen/pull/18196',
          reviews: [], // No reviews!
          commits: [
            makePrCommit({
              sha: 'edf1b1ff84ae3e508fa989c189a62ecbf44dd5aa',
              authorUsername: 'user-a',
              authorDate: '2026-01-25T10:00:00Z',
            }),
            makePrCommit({
              sha: '16708b817e1d16f34168b1f79d62e54aa5941592',
              authorUsername: 'user-a',
              authorDate: '2026-01-25T10:30:00Z',
            }),
          ],
          baseBranch: 'main',
        },
      },
      // Merge commit from unapproved PR (should be skipped)
      {
        sha: 'f92ec18',
        message: 'Merge branch unapproved-feature',
        authorUsername: 'user-a',
        authorDate: '2026-01-26T10:30:00Z',
        isMergeCommit: true,
        parentShas: ['6bbecc1', '16708b8'],
        htmlUrl: '',
        pr: null,
      },
      // Direct push revert (no PR)
      {
        sha: '55a83e761bcd32917d4d79bb892ff143951ecd8f',
        message: 'Revert "Merge branch unapproved-feature"',
        authorUsername: 'user-a',
        authorDate: '2026-01-26T10:35:00Z',
        isMergeCommit: false,
        parentShas: ['parent-7'],
        htmlUrl: 'https://github.com/navikt/pensjon-pen/commit/55a83e7',
        pr: null,
      },
      // Commits from approved deployed PR #18220
      {
        sha: 'e9ba01f37fdde990718fbdc66ae3713a392f7a2e',
        message: 'Commit in approved PR',
        authorUsername: 'user-b',
        authorDate: '2026-01-26T09:00:00Z',
        isMergeCommit: false,
        parentShas: ['parent-3'],
        htmlUrl: '',
        pr: null,
      },
      {
        sha: 'dbcb7c23209a5db6236dbdf50b6e1abe341002b5',
        message: 'Another commit in approved PR',
        authorUsername: 'user-b',
        authorDate: '2026-01-26T09:30:00Z',
        isMergeCommit: false,
        parentShas: ['parent-4'],
        htmlUrl: '',
        pr: null,
      },
      // Merge commit for deployed PR (matched by mergeCommitSha)
      {
        sha: 'deploy-sha-151',
        message: 'Merge pull request #18220',
        authorUsername: 'user-b',
        authorDate: '2026-01-26T11:00:00Z',
        isMergeCommit: true,
        parentShas: ['parent-8', 'parent-9'],
        htmlUrl: '',
        pr: null,
      },
    ],
  })

  it('should find exactly 4 unverified commits (including non-base-branch merge)', () => {
    const result = verifyDeployment(deployment151Input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(4)
  })

  it('should identify commits from PR #18196 with reason "no_approved_reviews"', () => {
    const result = verifyDeployment(deployment151Input)

    const pr18196Commits = result.unverifiedCommits.filter((c) => c.prNumber === 18196)
    expect(pr18196Commits).toHaveLength(2)

    for (const commit of pr18196Commits) {
      expect(commit.reason).toBe('no_approved_reviews')
    }
  })

  it('should identify direct push commit with reason "no_pr"', () => {
    const result = verifyDeployment(deployment151Input)

    const directPush = result.unverifiedCommits.find((c) => c.sha.startsWith('55a83e7'))
    expect(directPush).toBeDefined()
    expect(directPush?.reason).toBe('no_pr')
    expect(directPush?.prNumber).toBeNull()
  })

  it('should NOT mark commits from approved deployed PR #18220 as unverified', () => {
    const result = verifyDeployment(deployment151Input)

    const approvedPrShas = ['e9ba01f', 'dbcb7c2']
    const unverifiedShas = result.unverifiedCommits.map((c) => c.sha.substring(0, 7))

    for (const sha of approvedPrShas) {
      expect(unverifiedShas).not.toContain(sha)
    }
  })

  it('should skip base-branch merge commits but flag non-base-branch merges', () => {
    const result = verifyDeployment(deployment151Input)

    const unverifiedShas = result.unverifiedCommits.map((c) => c.sha.substring(0, 7))

    // Non-base-branch merge "Merge branch unapproved-feature" IS now flagged
    expect(unverifiedShas).toContain('f92ec18')

    // Deployed PR merge commit (deploy-sha-151) is verified via the deployed PR
    expect(unverifiedShas).not.toContain('deploy-s')
  })

  it('should include correct metadata for each unverified commit', () => {
    const result = verifyDeployment(deployment151Input)

    for (const commit of result.unverifiedCommits) {
      expect(commit.sha).toBeTruthy()
      expect(commit.message).toBeTruthy()
      expect(commit.author).toBeTruthy()
      expect(commit.date).toBeTruthy()
    }
  })
})

// =============================================================================
// verifyDeployment — approval_before_last_commit reason
// =============================================================================

describe('verifyDeployment - approval_before_last_commit reason', () => {
  it('should produce "approval_before_last_commit" when PR was approved then had new commits', () => {
    const input = makeBaseInput({
      commitsBetween: [
        {
          sha: 'commit-after-approval',
          message: 'Pushed after PR was approved',
          authorUsername: 'developer-a',
          authorDate: '2026-01-26T15:00:00Z',
          isMergeCommit: false,
          parentShas: ['parent'],
          htmlUrl: 'https://github.com/org/repo/commit/abc',
          pr: {
            number: 500,
            title: 'Feature with late push',
            url: 'https://github.com/org/repo/pull/500',
            reviews: [
              makePrReview({
                username: 'reviewer-b',
                submittedAt: '2026-01-26T13:00:00Z', // Before last commit
              }),
            ],
            commits: [
              makePrCommit({
                sha: 'first-commit',
                authorUsername: 'developer-a',
                authorDate: '2026-01-26T12:00:00Z',
              }),
              makePrCommit({
                sha: 'commit-after-approval',
                authorUsername: 'developer-a',
                authorDate: '2026-01-26T15:00:00Z', // After approval
              }),
            ],
            baseBranch: 'main',
          },
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(1)
    expect(result.unverifiedCommits[0].reason).toBe('approval_before_last_commit')
    expect(result.unverifiedCommits[0].prNumber).toBe(500)
  })
})
