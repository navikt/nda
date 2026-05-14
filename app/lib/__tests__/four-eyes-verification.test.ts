import { describe, expect, it } from 'vitest'
import type { PrCommit, PrMetadata, PrReview, VerificationInput } from '../verification/types'
import { verifyDeployment, verifyFourEyesFromPrData } from '../verification/verify'

/**
 * Tests for four-eyes verification logic.
 *
 * Covers two bugs found in real deployment (pensjon-psak deployment #10632):
 *
 * 1. Squash merge commit not recognized as deployed PR commit:
 *    GitHub creates a new SHA when squash-merging a PR. This SHA differs from
 *    the PR's head commit SHA. The verification must match the merge commit SHA
 *    to the deployed PR via `mergeCommitSha`.
 *
 * 2. Dependabot rebase after approval invalidates four-eyes:
 *    Dependabot may rebase (creating a new commit) after a reviewer approves.
 *    If the merger is someone other than the commit author, the merge action
 *    itself validates four-eyes because the merger saw the final state.
 *
 * Test data based on real PR pensjon-psak#2565 (dependabot storybook bump):
 * - PR author: dependabot[bot]
 * - Reviewer: walbo (APPROVED at 13:55:27)
 * - Dependabot commit: 83289528 at 13:57:06 (rebased after approval)
 * - Merge commit (squash): 158024d6 at 14:00:13 (merged by walbo)
 */

// =============================================================================
// Test Helpers
// =============================================================================

function makePrCommit(overrides: Partial<PrCommit> = {}): PrCommit {
  return {
    sha: 'default-commit-sha',
    message: 'Default commit message',
    authorUsername: 'developer-a',
    authorDate: '2026-02-27T12:00:00Z',
    committerDate: '2026-02-27T12:00:00Z',
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
    submittedAt: '2026-02-27T13:00:00Z',
    body: null,
    ...overrides,
  }
}

function makePrMetadata(overrides: Partial<PrMetadata> = {}): PrMetadata {
  return {
    number: 2565,
    title: 'Test PR',
    body: null,
    state: 'closed',
    merged: true,
    draft: false,
    createdAt: '2026-02-27T10:00:00Z',
    updatedAt: '2026-02-27T14:00:13Z',
    mergedAt: '2026-02-27T14:00:13Z',
    closedAt: '2026-02-27T14:00:13Z',
    baseBranch: 'main',
    baseSha: 'base-sha-000',
    headBranch: 'dependabot/npm_and_yarn/psak-frontend/storybook-9.1.19',
    headSha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
    mergeCommitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
    author: { username: 'dependabot[bot]' },
    mergedBy: { username: 'walbo' },
    labels: ['dependencies'],
    commitsCount: 1,
    changedFiles: 2,
    additions: 10,
    deletions: 10,
    ...overrides,
  }
}

function makeBaseInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    deploymentId: 10632,
    commitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
    repository: 'navikt/pensjon-psak',
    environmentName: 'prod-fss',
    baseBranch: 'main',
    repositoryStatus: 'active',
    commitOnBaseBranch: true,
    auditStartYear: 2025,
    implicitApprovalSettings: { mode: 'off' },
    previousDeployment: {
      id: 10631,
      commitSha: 'prev-deploy-sha-000',
      createdAt: '2026-02-26T10:00:00Z',
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
// verifyFourEyesFromPrData - Unit Tests
// =============================================================================

describe('verifyFourEyesFromPrData', () => {
  describe('basic approval after last commit', () => {
    it('should approve when review is after last commit', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ submittedAt: '2026-02-27T14:00:00Z' })],
        commits: [makePrCommit({ authorDate: '2026-02-27T13:00:00Z' })],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('after last commit')
    })

    it('should reject when review is before last commit', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ submittedAt: '2026-02-27T12:00:00Z' })],
        commits: [makePrCommit({ authorDate: '2026-02-27T13:00:00Z' })],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('approval_before_last_commit')
    })

    it('should reject when there are no reviews', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [],
        commits: [makePrCommit()],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('no_approved_reviews')
    })

    it('should reject when there are no commits', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview()],
        commits: [],
        baseBranch: 'main',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('No commits found in PR')
    })
  })

  describe('merger validates four-eyes (dependabot rebase scenario)', () => {
    it('should approve when merger is not a commit author and there are approvals', () => {
      // Scenario: dependabot rebases after approval, walbo merges
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ username: 'walbo', submittedAt: '2026-02-27T13:55:27Z' })],
        commits: [makePrCommit({ authorUsername: 'dependabot[bot]', authorDate: '2026-02-27T13:57:06Z' })],
        baseBranch: 'main',
        mergedBy: 'walbo',
      })
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('merged by walbo')
      expect(result.reason).toContain('not a commit author')
    })

    it('should not approve when merger is the commit author', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ username: 'reviewer-b', submittedAt: '2026-02-27T12:00:00Z' })],
        commits: [makePrCommit({ authorUsername: 'developer-a', authorDate: '2026-02-27T13:00:00Z' })],
        baseBranch: 'main',
        mergedBy: 'developer-a',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('approval_before_last_commit')
    })

    it('should not approve when merger matches any commit author (case-insensitive)', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ submittedAt: '2026-02-27T11:00:00Z' })],
        commits: [
          makePrCommit({ authorUsername: 'Developer-A', authorDate: '2026-02-27T12:00:00Z' }),
          makePrCommit({ authorUsername: 'developer-b', authorDate: '2026-02-27T13:00:00Z' }),
        ],
        baseBranch: 'main',
        mergedBy: 'developer-a', // matches Developer-A case-insensitively
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('approval_before_last_commit')
    })

    it('should not approve via merger when there are no approved reviews', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ state: 'COMMENTED', submittedAt: '2026-02-27T13:55:27Z' })],
        commits: [makePrCommit({ authorUsername: 'dependabot[bot]', authorDate: '2026-02-27T13:57:06Z' })],
        baseBranch: 'main',
        mergedBy: 'walbo',
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('no_approved_reviews')
    })

    it('should fall back to normal behavior when mergedBy is not provided', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ submittedAt: '2026-02-27T12:00:00Z' })],
        commits: [makePrCommit({ authorDate: '2026-02-27T13:00:00Z' })],
        baseBranch: 'main',
        // mergedBy not provided
      })
      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('approval_before_last_commit')
    })

    it('should still prefer review-after-commit when both conditions are met', () => {
      // Review is after last commit — should use the standard path, not merger path
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ username: 'walbo', submittedAt: '2026-02-27T14:00:00Z' })],
        commits: [makePrCommit({ authorUsername: 'dependabot[bot]', authorDate: '2026-02-27T13:00:00Z' })],
        baseBranch: 'main',
        mergedBy: 'walbo',
      })
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('after last commit')
      // Should NOT mention merger since the standard path handled it
      expect(result.reason).not.toContain('merged by')
    })
  })

  describe('base branch merge commits are ignored', () => {
    it('should ignore base-merge commits when finding last real commit', () => {
      const result = verifyFourEyesFromPrData({
        reviewers: [makePrReview({ submittedAt: '2026-02-27T13:30:00Z' })],
        commits: [
          makePrCommit({ authorDate: '2026-02-27T13:00:00Z', message: 'Real work' }),
          makePrCommit({
            authorDate: '2026-02-27T14:00:00Z',
            message: "Merge branch 'main' into feature",
          }),
        ],
        baseBranch: 'main',
      })
      // Review at 13:30 is after real commit at 13:00, merge commit at 14:00 is ignored
      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('after ignoring 1 base-merge commit(s)')
    })
  })
})

// =============================================================================
// verifyDeployment - Squash Merge Commit Matching Tests
// =============================================================================

describe('verifyDeployment - squash merge commit matching', () => {
  it('should match squash merge commit to deployed PR via mergeCommitSha', () => {
    // Real scenario: pensjon-psak#2565
    // Deployed SHA is 158024d6 (squash merge), PR head is 83289528
    const input = makeBaseInput({
      commitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
      deployedPr: {
        number: 2565,
        url: 'https://github.com/navikt/pensjon-psak/pull/2565',
        metadata: makePrMetadata({
          headSha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
          mergeCommitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
          author: { username: 'dependabot[bot]' },
          mergedBy: { username: 'walbo' },
        }),
        reviews: [makePrReview({ username: 'walbo', submittedAt: '2026-02-27T13:55:27Z' })],
        commits: [
          makePrCommit({
            sha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
            authorUsername: 'dependabot[bot]',
            authorDate: '2026-02-27T13:57:06Z',
            committerDate: '2026-02-27T13:57:06Z',
            message: 'Bump storybook from 9.1.16 to 9.1.19 in /psak-frontend',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
          message: 'Bump storybook from 9.1.16 to 9.1.19 in /psak-frontend (#2565)',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T14:00:13Z',
          isMergeCommit: false,
          parentShas: ['81d233fff28f06ff9622bed37e6ee6eeb18c826f'],
          htmlUrl: 'https://github.com/navikt/pensjon-psak/commit/158024d6ef97',
          pr: null, // The commit.pr path is not needed when matched via deployedPr
        },
      ],
    })

    const result = verifyDeployment(input)
    expect(result.hasFourEyes).toBe(true)
    expect(result.status).toBe('approved')
  })

  it('should still match PR commits by direct SHA', () => {
    // Standard case: commitsBetween SHA matches a PR commit SHA directly
    const input = makeBaseInput({
      deployedPr: {
        number: 100,
        url: 'https://github.com/org/repo/pull/100',
        metadata: makePrMetadata({
          headSha: 'abc123',
          mergeCommitSha: 'merge-sha-999',
          mergedBy: { username: 'reviewer-b' },
        }),
        reviews: [makePrReview({ submittedAt: '2026-02-27T14:00:00Z' })],
        commits: [makePrCommit({ sha: 'abc123', authorDate: '2026-02-27T13:00:00Z' })],
      },
      commitsBetween: [
        {
          sha: 'abc123',
          message: 'Some commit',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T13:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)
    expect(result.hasFourEyes).toBe(true)
    expect(result.status).toBe('approved')
  })

  it('should not match random commits to deployed PR via mergeCommitSha', () => {
    // A commit that is neither in PR commits nor the merge commit SHA
    const input = makeBaseInput({
      deployedPr: {
        number: 100,
        url: 'https://github.com/org/repo/pull/100',
        metadata: makePrMetadata({
          headSha: 'abc123',
          mergeCommitSha: 'merge-sha-999',
          mergedBy: { username: 'reviewer-b' },
        }),
        reviews: [makePrReview({ submittedAt: '2026-02-27T14:00:00Z' })],
        commits: [makePrCommit({ sha: 'abc123', authorDate: '2026-02-27T13:00:00Z' })],
      },
      commitsBetween: [
        {
          sha: 'unrelated-sha',
          message: 'Unrelated commit',
          authorUsername: 'developer-x',
          authorDate: '2026-02-27T13:30:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(1)
    expect(result.unverifiedCommits[0].sha).toBe('unrelated-sha')
    expect(result.unverifiedCommits[0].reason).toBe('no_pr')
  })
})

// =============================================================================
// verifyDeployment - Full Dependabot Rebase Scenario (E2E)
// =============================================================================

describe('verifyDeployment - dependabot rebase after approval (e2e)', () => {
  /**
   * Reproduces the exact scenario from pensjon-psak deployment #10632:
   * 1. dependabot creates PR #2565 with commit 83289528 at 13:57:06
   * 2. walbo approves at 13:55:27 (BEFORE the commit - dependabot rebased after)
   * 3. walbo merges at 14:00:13, creating squash merge commit 158024d6
   * 4. Deployment uses 158024d6 as the deployed commit
   */
  const realWorldInput = makeBaseInput({
    commitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
    deployedPr: {
      number: 2565,
      url: 'https://github.com/navikt/pensjon-psak/pull/2565',
      metadata: makePrMetadata({
        headSha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
        mergeCommitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
        author: { username: 'dependabot[bot]' },
        mergedBy: { username: 'walbo' },
        mergedAt: '2026-02-27T14:00:13Z',
      }),
      reviews: [
        makePrReview({
          id: 1,
          username: 'walbo',
          state: 'APPROVED',
          submittedAt: '2026-02-27T13:55:27Z',
        }),
      ],
      commits: [
        makePrCommit({
          sha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
          message: 'Bump storybook from 9.1.16 to 9.1.19 in /psak-frontend',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T13:57:06Z',
          committerDate: '2026-02-27T13:57:06Z',
        }),
      ],
    },
    commitsBetween: [
      {
        sha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
        message: 'Bump storybook from 9.1.16 to 9.1.19 in /psak-frontend (#2565)',
        authorUsername: 'dependabot[bot]',
        authorDate: '2026-02-27T14:00:13Z',
        isMergeCommit: false,
        parentShas: ['81d233fff28f06ff9622bed37e6ee6eeb18c826f'],
        htmlUrl: 'https://github.com/navikt/pensjon-psak/commit/158024d6ef97',
        pr: {
          number: 2565,
          title: 'Bump storybook from 9.1.16 to 9.1.19 in /psak-frontend',
          url: 'https://github.com/navikt/pensjon-psak/pull/2565',
          reviews: [
            makePrReview({
              id: 1,
              username: 'walbo',
              state: 'APPROVED',
              submittedAt: '2026-02-27T13:55:27Z',
            }),
          ],
          commits: [
            makePrCommit({
              sha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
              message: 'Bump storybook from 9.1.16 to 9.1.19 in /psak-frontend',
              authorUsername: 'dependabot[bot]',
              authorDate: '2026-02-27T13:57:06Z',
              committerDate: '2026-02-27T13:57:06Z',
            }),
          ],
          baseBranch: 'main',
        },
      },
    ],
  })

  it('should approve the deployment (squash merge + merger validates)', () => {
    const result = verifyDeployment(realWorldInput)

    expect(result.hasFourEyes).toBe(true)
    expect(result.status).toBe('approved')
    expect(result.unverifiedCommits).toHaveLength(0)
  })

  it('should NOT approve if implicit approval is off and mergedBy is not available', () => {
    // If mergeCommitSha didn't match AND mergedBy was not set, should fail
    const deployedPr = realWorldInput.deployedPr
    if (!deployedPr) throw new Error('Test setup error')
    const input = makeBaseInput({
      ...realWorldInput,
      deployedPr: {
        ...deployedPr,
        metadata: makePrMetadata({
          headSha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
          mergeCommitSha: null, // no merge commit SHA
          author: { username: 'dependabot[bot]' },
          mergedBy: null, // no merger info
        }),
      },
    })

    const result = verifyDeployment(input)

    // Without mergeCommitSha match, falls to commit.pr path
    // Without mergedBy, can't validate via merger
    // Should be unverified
    expect(result.hasFourEyes).toBe(false)
  })

  it('should approve via implicit approval (dependabot_only mode) as alternative', () => {
    // Even without the merger fix, implicit approval should work
    const input = makeBaseInput({
      ...realWorldInput,
      implicitApprovalSettings: { mode: 'dependabot_only' },
    })

    const result = verifyDeployment(input)
    expect(result.hasFourEyes).toBe(true)
  })
})

// =============================================================================
// verifyDeployment - verification-diff page scenario
// =============================================================================

describe('verifyDeployment - verification-diff page (implicit approval off)', () => {
  /**
   * The verification-diff page (team.$team.env.$env.app.$app.admin.verification-diff.tsx)
   * always runs with implicitApprovalSettings: { mode: 'off' }.
   * These tests verify that the squash merge + merger-validates fixes work
   * even without implicit approval enabled, matching the verification-diff behavior.
   */

  it('should approve dependabot squash merge with implicit approval off', () => {
    // This is exactly the scenario verification-diff encounters:
    // - metadata comes from snapshot (includes mergeCommitSha + mergedBy)
    // - implicitApprovalSettings is hardcoded to { mode: 'off' }
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'off' },
      commitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
      deployedPr: {
        number: 2565,
        url: 'https://github.com/navikt/pensjon-psak/pull/2565',
        metadata: makePrMetadata({
          headSha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
          mergeCommitSha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
          author: { username: 'dependabot[bot]' },
          mergedBy: { username: 'walbo' },
        }),
        reviews: [makePrReview({ username: 'walbo', submittedAt: '2026-02-27T13:55:27Z' })],
        commits: [
          makePrCommit({
            sha: '8328952808bfbfaebdba21b3d09cb60beec88d28',
            authorUsername: 'dependabot[bot]',
            authorDate: '2026-02-27T13:57:06Z',
            committerDate: '2026-02-27T13:57:06Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: '158024d6ef97309f655e8840c958fc48b2b5dccb',
          message: 'Bump storybook from 9.1.16 to 9.1.19 (#2565)',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T14:00:13Z',
          isMergeCommit: false,
          parentShas: ['81d233fff28f06ff9622bed37e6ee6eeb18c826f'],
          htmlUrl: '',
          pr: null, // verification-diff uses cacheOnly, may not have commit.pr
        },
      ],
    })

    const result = verifyDeployment(input)
    expect(result.hasFourEyes).toBe(true)
    expect(result.status).toBe('approved')
    expect(result.unverifiedCommits).toHaveLength(0)
  })

  it('should detect diff when old result was unverified but new result is approved', () => {
    // Simulates the comparison verification-diff performs
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'off' },
      deployedPr: {
        number: 100,
        url: 'https://github.com/org/repo/pull/100',
        metadata: makePrMetadata({
          headSha: 'pr-head-sha',
          mergeCommitSha: 'squash-merge-sha',
          author: { username: 'bot[bot]' },
          mergedBy: { username: 'human-reviewer' },
        }),
        reviews: [makePrReview({ username: 'human-reviewer', submittedAt: '2026-02-27T12:00:00Z' })],
        commits: [
          makePrCommit({
            sha: 'pr-head-sha',
            authorUsername: 'bot[bot]',
            authorDate: '2026-02-27T12:05:00Z', // after review
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-merge-sha',
          message: 'Bot update (#100)',
          authorUsername: 'bot[bot]',
          authorDate: '2026-02-27T12:10:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const newResult = verifyDeployment(input)

    // Old result would have been: hasFourEyes=false (before the fix)
    // New result should be: hasFourEyes=true (merger validates)
    expect(newResult.hasFourEyes).toBe(true)
    expect(newResult.status).toBe('approved')

    // This is the comparison verification-diff does:
    const oldHasFourEyes = false // simulated old stored result
    const statusChanged = oldHasFourEyes !== newResult.hasFourEyes
    expect(statusChanged).toBe(true) // diff detected
  })

  it('should not approve when commit.pr is used and mergedBy is unavailable', () => {
    // When commitsBetween SHA doesn't match mergeCommitSha,
    // and the commit falls to commit.pr path without mergedBy
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'off' },
      deployedPr: null, // no deployed PR
      commitsBetween: [
        {
          sha: 'some-commit',
          message: 'Some change (#50)',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T13:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: {
            number: 50,
            title: 'Some change',
            url: 'https://github.com/org/repo/pull/50',
            reviews: [
              makePrReview({ submittedAt: '2026-02-27T12:00:00Z' }), // before commit
            ],
            commits: [makePrCommit({ authorDate: '2026-02-27T13:00:00Z' })],
            baseBranch: 'main',
            // note: commit.pr doesn't have mergedBy
          },
        },
      ],
    })

    const result = verifyDeployment(input)
    // commit.pr path doesn't pass mergedBy, so merger-validates fix doesn't apply
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(1)
    expect(result.unverifiedCommits[0].reason).toBe('approval_before_last_commit')
  })
})
