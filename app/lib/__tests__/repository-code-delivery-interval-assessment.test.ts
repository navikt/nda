import { describe, expect, it } from 'vitest'
import { assessRepositoryDeliveryInterval } from '~/lib/repository-code-delivery/interval-assessment'

const commitSha = '1'.repeat(40)
const prCommit = {
  sha: commitSha,
  message: 'Add feature',
  authorUsername: 'Glad Fjord',
  authorLogin: 'glad-fjord',
  authorDate: '2026-10-01T10:00:00Z',
  committerDate: '2026-10-01T10:00:00Z',
  isMergeCommit: false,
  parentShas: ['0'.repeat(40)],
}
const compare = {
  status: 'ahead',
  aheadBy: 1,
  behindBy: 0,
  totalCommits: 1,
  commits: [
    {
      sha: commitSha,
      message: 'Add feature',
      authorUsername: 'glad-fjord',
      authorLogin: 'glad-fjord',
      authorDate: '2026-10-01T10:00:00Z',
      committerDate: '2026-10-01T10:00:00Z',
      parentShas: ['0'.repeat(40)],
      isMergeCommit: false,
      htmlUrl: `https://github.com/navikt/repo/commit/${commitSha}`,
    },
  ],
}
const associatedPullRequests = {
  [commitSha]: {
    complete: true,
    pullRequests: [{ number: 42, baseBranch: 'main' }],
  },
}
const approvedPullRequest = {
  42: {
    number: 42,
    baseBranch: 'main',
    baseSha: '0'.repeat(40),
    headBranch: 'feature/change',
    authorLogin: 'glad-fjord',
    mergedByLogin: 'rask-elv',
    mergeCommitSha: null,
    mergedAt: null,
    headSha: commitSha,
    commitCount: 1,
    commits: [prCommit],
    reviews: [
      {
        id: 7,
        username: 'rask-elv',
        state: 'APPROVED' as const,
        submittedAt: '2026-10-01T11:00:00Z',
        body: null,
        commitId: commitSha,
      },
    ],
  },
}

function assess(overrides: Partial<Parameters<typeof assessRepositoryDeliveryInterval>[0]> = {}) {
  return assessRepositoryDeliveryInterval({
    compare,
    defaultBranch: 'main',
    implicitApprovalMode: 'off',
    associatedPullRequestsByCommit: associatedPullRequests,
    pullRequestsByNumber: approvedPullRequest,
    ...overrides,
  })
}

describe('repository code delivery interval assessment', () => {
  it('marks a commit covered when a separate user approved after the last PR commit', () => {
    expect(assess().commits[0]).toMatchObject({
      status: 'covered',
      reason: 'approved_review',
      pullRequestNumber: 42,
    })
    expect(assess().state).toBe('complete')
  })

  it('marks complete PR evidence without an approved review as not covered', () => {
    const result = assess({
      pullRequestsByNumber: {
        42: { ...approvedPullRequest[42], reviews: [] },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'not_covered',
      reason: 'no_approved_reviews',
    })
  })

  it('does not treat an approval before the last commit as coverage', () => {
    const result = assess({
      pullRequestsByNumber: {
        42: {
          ...approvedPullRequest[42],
          reviews: [
            {
              id: 7,
              username: 'rask-elv',
              state: 'APPROVED',
              submittedAt: '2026-10-01T09:00:00Z',
              body: null,
              commitId: null,
            },
          ],
        },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'not_covered',
      reason: 'approval_before_last_commit',
    })
  })

  it('uses the configured implicit approval mode from the repository', () => {
    const result = assess({
      implicitApprovalMode: 'all',
      pullRequestsByNumber: {
        42: {
          ...approvedPullRequest[42],
          reviews: [
            {
              id: 7,
              username: 'rask-elv',
              state: 'APPROVED',
              submittedAt: '2026-10-01T09:00:00Z',
              body: null,
              commitId: null,
            },
          ],
        },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'covered',
      reason: 'implicit_approval',
    })
  })

  it('keeps a commit unknown when its association snapshot is missing', () => {
    const result = assess({ associatedPullRequestsByCommit: {} })
    expect(result.commits[0]).toMatchObject({
      status: 'unknown',
      reason: 'missing_associated_pull_request_snapshot',
    })
    expect(result.state).toBe('incomplete')
  })

  it('treats a commit with no associated PR as not covered only when an empty snapshot exists', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: { complete: true, pullRequests: [] },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'not_covered',
      reason: 'no_associated_pull_request',
    })
  })

  it('marks the interval incomplete and counts commits omitted from the compare snapshot as unknown', () => {
    const result = assess({
      compare: { ...compare, aheadBy: 2, totalCommits: 2 },
    })
    expect(result).toMatchObject({
      state: 'incomplete',
      listedCommits: 1,
      totalCommits: 2,
      omittedCommits: 1,
      summary: { covered: 1, unknown: 1 },
    })
  })

  it('keeps a commit unknown when the PR commit snapshot does not match its declared count', () => {
    const result = assess({
      pullRequestsByNumber: {
        42: { ...approvedPullRequest[42], commitCount: 2 },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'unknown',
      reason: 'incomplete_pull_request_snapshot',
    })
  })

  it('keeps a commit unknown when the stored PR head does not match the latest stored commit', () => {
    const result = assess({
      pullRequestsByNumber: {
        42: { ...approvedPullRequest[42], headSha: '2'.repeat(40) },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'unknown',
      reason: 'pull_request_head_mismatch',
    })
  })

  it('prefers a later approved PR over an earlier unapproved PR', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [
            { number: 41, baseBranch: 'main' },
            { number: 42, baseBranch: 'main' },
          ],
        },
      },
      pullRequestsByNumber: {
        41: { ...approvedPullRequest[42], number: 41, reviews: [] },
        42: approvedPullRequest[42],
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'covered',
      pullRequestNumber: 42,
      reason: 'approved_review',
    })
  })

  it('prefers proven coverage over an earlier PR with missing snapshots', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [
            { number: 41, baseBranch: 'main' },
            { number: 42, baseBranch: 'main' },
          ],
        },
      },
      pullRequestsByNumber: {
        42: approvedPullRequest[42],
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'covered',
      pullRequestNumber: 42,
      reason: 'approved_review',
    })
  })

  it('accepts an approved PR when a merged stack chain reaches the default branch', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [{ number: 43, baseBranch: 'feature/base' }],
        },
      },
      pullRequestsByNumber: {
        42: {
          ...approvedPullRequest[42],
          number: 42,
          baseBranch: 'main',
          headBranch: 'feature/base',
          headSha: '2'.repeat(40),
          mergeCommitSha: '4'.repeat(40),
          mergedAt: '2026-10-01T12:00:00Z',
        },
        43: {
          ...approvedPullRequest[42],
          number: 43,
          baseBranch: 'feature/base',
          baseSha: '2'.repeat(40),
          headBranch: 'feature/stacked',
          headSha: commitSha,
          mergeCommitSha: '5'.repeat(40),
          mergedAt: '2026-10-01T13:00:00Z',
        },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'covered',
      reason: 'approved_review',
      pullRequestNumber: 43,
    })
  })

  it('does not accept an approved side-branch PR without a merged path to the default branch', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [{ number: 43, baseBranch: 'feature/unrelated' }],
        },
      },
      pullRequestsByNumber: {
        43: {
          ...approvedPullRequest[42],
          number: 43,
          baseBranch: 'feature/unrelated',
          baseSha: '2'.repeat(40),
          headBranch: 'feature/change',
          headSha: commitSha,
          mergeCommitSha: '5'.repeat(40),
          mergedAt: '2026-10-01T13:00:00Z',
        },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'not_covered',
      reason: 'no_default_branch_pull_request',
    })
  })

  it('returns unknown when no PR covers a commit and another PR candidate is unresolved', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [
            { number: 41, baseBranch: 'main' },
            { number: 42, baseBranch: 'main' },
          ],
        },
      },
      pullRequestsByNumber: {
        41: { ...approvedPullRequest[42], number: 41, reviews: [] },
      },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'unknown',
      pullRequestNumber: 42,
      reason: 'missing_pull_request_snapshot',
    })
  })

  it('reports unavailable when no stored compare snapshot can be used', () => {
    expect(assess({ compare: null })).toMatchObject({
      state: 'unavailable',
      totalCommits: null,
      summary: { covered: 0, notCovered: 0, unknown: 0 },
    })
  })
})
