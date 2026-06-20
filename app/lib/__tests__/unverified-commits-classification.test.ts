import { describe, expect, it } from 'vitest'
import type { ImplicitApprovalSettings, PrCommit, PrMetadata, PrReview, VerificationInput } from '../verification/types'
import { verifyDeployment } from '../verification/verify'

function makeMetadata(overrides: Partial<PrMetadata> = {}): PrMetadata {
  return {
    number: 42,
    title: 'feature',
    body: null,
    state: 'closed',
    merged: true,
    draft: false,
    createdAt: '2026-01-14T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    mergedAt: '2026-01-15T14:00:00Z',
    closedAt: '2026-01-15T14:00:00Z',
    baseBranch: 'main',
    baseSha: 'base-sha',
    headBranch: 'feature-branch',
    headSha: 'head-sha',
    mergeCommitSha: null,
    author: { username: 'alice', avatarUrl: '' },
    mergedBy: null,
    labels: [],
    commitsCount: 1,
    changedFiles: 1,
    additions: 10,
    deletions: 2,
    ...overrides,
  }
}

function makeCommit(overrides: Partial<VerificationInput['commitsBetween'][0]> = {}) {
  return {
    sha: 'abc1234',
    message: 'feat: something',
    authorUsername: 'alice',
    authorDate: '2026-01-15T10:00:00Z',
    isMergeCommit: false,
    parentShas: ['parent1'],
    htmlUrl: 'https://github.com/org/repo/commit/abc1234',
    pr: null,
    ...overrides,
  }
}

function makePrCommit(overrides: Partial<PrCommit> = {}): PrCommit {
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

function makeInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    deploymentId: 1,
    commitSha: 'deploy-sha',
    repository: 'org/repo',
    environmentName: 'prod',
    baseBranch: 'main',
    repositoryStatus: 'active',
    commitOnBaseBranch: true,
    auditStartYear: null,
    implicitApprovalSettings: { mode: 'off' } as ImplicitApprovalSettings,
    previousDeployment: { id: 0, commitSha: 'prev-sha', createdAt: '2026-01-10T00:00:00Z' },
    deployedPr: null,
    commitsBetween: [],
    compareSummary: null,
    dataFreshness: { deployedPrFetchedAt: new Date(), commitsFetchedAt: new Date(), schemaVersion: 3 },
    ...overrides,
  }
}

describe('commit classification in findUnverifiedCommits', () => {
  describe('commits in deployed PR', () => {
    it('marks as verified when deployed PR is approved', () => {
      const prCommit = makePrCommit({ sha: 'c1' })
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [makeCommit({ sha: 'c1' })],
          deployedPr: {
            number: 42,
            url: 'https://github.com/org/repo/pull/42',
            metadata: makeMetadata(),
            reviews: [makeReview({ submittedAt: '2026-01-15T12:00:00Z' })],
            commits: [prCommit],
          },
        }),
      )
      expect(result.status).toBe('approved')
      expect(result.unverifiedCommits).toHaveLength(0)
    })

    it('lists as unverified when deployed PR has no approvals', () => {
      const prCommit = makePrCommit({ sha: 'c1' })
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [makeCommit({ sha: 'c1' })],
          deployedPr: {
            number: 42,
            url: 'https://github.com/org/repo/pull/42',
            metadata: makeMetadata(),
            reviews: [],
            commits: [prCommit],
          },
        }),
      )
      expect(result.status).toBe('unverified_commits')
      expect(result.unverifiedCommits).toHaveLength(1)
      expect(result.unverifiedCommits[0].reason).toBe('no_approved_reviews')
      expect(result.unverifiedCommits[0].prNumber).toBe(42)
    })

    it('matches merge commit SHA to deployed PR', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [makeCommit({ sha: 'merge-sha' })],
          deployedPr: {
            number: 42,
            url: 'https://github.com/org/repo/pull/42',
            metadata: makeMetadata({ mergeCommitSha: 'merge-sha' }),
            reviews: [makeReview({ submittedAt: '2026-01-15T12:00:00Z' })],
            commits: [makePrCommit({ sha: 'c1' })],
          },
        }),
      )
      expect(result.status).toBe('approved')
    })
  })

  describe('commits with their own PR', () => {
    it('marks as verified when commit PR is approved', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [
            makeCommit({
              sha: 'c1',
              pr: {
                number: 99,
                title: 'other PR',
                url: 'https://github.com/org/repo/pull/99',
                reviews: [makeReview({ submittedAt: '2026-01-15T12:00:00Z' })],
                commits: [makePrCommit({ sha: 'c1' })],
                baseBranch: 'main',
              },
            }),
          ],
        }),
      )
      expect(result.status).toBe('approved')
    })

    it('lists as unverified when commit PR has approval before last commit', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [
            makeCommit({
              sha: 'c1',
              pr: {
                number: 99,
                title: 'other PR',
                url: 'https://github.com/org/repo/pull/99',
                reviews: [makeReview({ submittedAt: '2026-01-14T08:00:00Z' })],
                commits: [
                  makePrCommit({
                    sha: 'c1',
                    authorDate: '2026-01-15T10:00:00Z',
                    committerDate: '2026-01-15T10:00:00Z',
                  }),
                ],
                baseBranch: 'main',
              },
            }),
          ],
        }),
      )
      expect(result.status).toBe('unverified_commits')
      expect(result.unverifiedCommits[0].reason).toBe('approval_before_last_commit')
    })
  })

  describe('commits without any PR', () => {
    it('marks as unverified with no_pr reason', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [makeCommit({ sha: 'c1', pr: null })],
        }),
      )
      expect(result.status).toBe('unverified_commits')
      expect(result.unverifiedCommits).toHaveLength(1)
      expect(result.unverifiedCommits[0].reason).toBe('no_pr')
      expect(result.unverifiedCommits[0].prNumber).toBeNull()
    })
  })

  describe('merge commits', () => {
    it('skips base branch merge commits', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [
            makeCommit({ sha: 'merge1', message: "Merge branch 'main' into feature-x", isMergeCommit: true }),
            makeCommit({
              sha: 'c1',
              pr: {
                number: 10,
                title: 'good PR',
                url: 'url',
                reviews: [makeReview({ submittedAt: '2026-01-15T12:00:00Z' })],
                commits: [makePrCommit({ sha: 'c1' })],
                baseBranch: 'main',
              },
            }),
          ],
        }),
      )
      expect(result.status).toBe('approved')
    })

    it('does NOT skip non-base merge commits', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [makeCommit({ sha: 'merge1', message: 'Merge conflict resolution', isMergeCommit: true })],
        }),
      )
      expect(result.status).toBe('unverified_commits')
      expect(result.unverifiedCommits[0].sha).toBe('merge1')
    })
  })

  describe('mixed scenarios', () => {
    it('classifies each commit independently', () => {
      const result = verifyDeployment(
        makeInput({
          commitsBetween: [
            makeCommit({
              sha: 'good',
              pr: {
                number: 10,
                title: 'approved PR',
                url: 'url',
                reviews: [makeReview({ submittedAt: '2026-01-15T12:00:00Z' })],
                commits: [makePrCommit({ sha: 'good' })],
                baseBranch: 'main',
              },
            }),
            makeCommit({ sha: 'bad', pr: null }),
          ],
        }),
      )
      expect(result.status).toBe('unverified_commits')
      expect(result.unverifiedCommits).toHaveLength(1)
      expect(result.unverifiedCommits[0].sha).toBe('bad')
    })
  })
})
