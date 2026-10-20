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
    stackParentPullRequestNumbersByNumber: {},
    stackAncestryByPullRequestNumber: {},
    ...overrides,
  })
}

function parentFirstStack(): Parameters<typeof assessRepositoryDeliveryInterval>[0] {
  const parentMergeSha = 'a241f12fbf597182791089f45283200807e30c35'
  const childMergeSha = '95acc5e50eb2137ba03c4c7a7f7db43ba63a5952'
  const defaultBranchMergeSha = '6b89c946c91d7563af68b7a542f0173be27cbf94'
  const entries = [
    {
      number: 233,
      baseBranch: 'main',
      headSha: '73a1112a74d670fde0c190522804872a55356923',
      mergeSha: parentMergeSha,
      parentSha: '98b7abf4d6a2b95789358d9af52b7d2804c4acaf',
      mergedAt: '2026-09-21T10:48:00Z',
    },
    {
      number: 234,
      baseBranch: 'sp-forvaltning/confirm-form-validation',
      headSha: '6d0751d9b39a19d0ab423faf27fdd549f9620802',
      mergeSha: childMergeSha,
      parentSha: parentMergeSha,
      mergedAt: '2026-09-21T10:48:01Z',
    },
    {
      number: 232,
      baseBranch: 'main',
      headSha: 'dca17f13a5a1b0df09c355c3a2785896923d5781',
      mergeSha: defaultBranchMergeSha,
      parentSha: childMergeSha,
      mergedAt: '2026-09-22T12:12:58Z',
    },
  ]
  return {
    compare: {
      status: 'ahead',
      aheadBy: 3,
      behindBy: 0,
      totalCommits: 3,
      commits: entries.map((entry) => ({
        ...compare.commits[0],
        sha: entry.mergeSha,
        parentShas: [entry.parentSha],
      })),
    },
    defaultBranch: 'main',
    implicitApprovalMode: 'off',
    associatedPullRequestsByCommit: Object.fromEntries(
      entries.map((entry) => [
        entry.mergeSha,
        { complete: true, pullRequests: [{ number: entry.number, baseBranch: entry.baseBranch }] },
      ]),
    ),
    pullRequestsByNumber: Object.fromEntries(
      entries.map((entry) => [
        entry.number,
        {
          ...approvedPullRequest[42],
          number: entry.number,
          baseBranch: entry.baseBranch,
          headSha: entry.headSha,
          mergeCommitSha: entry.mergeSha,
          mergedAt: entry.mergedAt,
          commits: [
            {
              ...prCommit,
              sha: entry.headSha,
              authorDate: '2026-09-18T12:00:08Z',
              committerDate: '2026-09-18T12:00:08Z',
            },
          ],
          reviews: [
            {
              ...approvedPullRequest[42].reviews[0],
              submittedAt: '2026-09-21T10:47:20Z',
              commitId: entry.headSha,
            },
          ],
        },
      ]),
    ),
    stackParentPullRequestNumbersByNumber: { 234: [233] },
    stackAncestryByPullRequestNumber: { 234: { 233: 'diverged' } },
  }
}

describe('repository code delivery interval assessment', () => {
  it('covers a parent-first stack through the stored delivery path to a later default-branch merge', () => {
    const result = assessRepositoryDeliveryInterval(parentFirstStack())

    expect(result).toMatchObject({
      state: 'complete',
      summary: { covered: 3, notCovered: 0, unknown: 0 },
      commits: [
        { pullRequestNumber: 233, status: 'covered' },
        { pullRequestNumber: 234, status: 'covered', reason: 'approved_review' },
        { pullRequestNumber: 232, status: 'covered' },
      ],
    })
  })

  it.each([
    'unmerged_anchor',
    'wrong_anchor_merge',
    'side_branch_anchor',
    'missing_association',
    'incomplete_association',
    'mismatched_association',
    'broken_path',
    'incomplete_compare',
    'invalid_compare',
    'duplicate_commit',
    'unmerged_child',
  ] as const)('does not infer a default-branch path from %s', (scenario) => {
    const input = parentFirstStack()
    const anchor = input.pullRequestsByNumber[232]
    const child = input.pullRequestsByNumber[234]
    if (!input.compare || !anchor || !child) throw new Error('Missing stack fixture')
    if (scenario === 'unmerged_anchor') anchor.mergedAt = null
    if (scenario === 'wrong_anchor_merge') anchor.mergeCommitSha = '9'.repeat(40)
    if (scenario === 'side_branch_anchor') anchor.baseBranch = 'feature/unrelated'
    if (scenario === 'missing_association') delete input.associatedPullRequestsByCommit[input.compare.commits[2].sha]
    if (scenario === 'incomplete_association') {
      input.associatedPullRequestsByCommit[input.compare.commits[2].sha] = {
        complete: false,
        pullRequests: [{ number: 232, baseBranch: 'main' }],
      }
    }
    if (scenario === 'mismatched_association') {
      input.associatedPullRequestsByCommit[input.compare.commits[2].sha] = {
        complete: true,
        pullRequests: [{ number: 232, baseBranch: 'feature/unrelated' }],
      }
    }
    if (scenario === 'broken_path') input.compare.commits[2].parentShas = [input.compare.commits[0].sha]
    if (scenario === 'incomplete_compare') {
      input.compare.totalCommits = 4
      input.compare.aheadBy = 4
    }
    if (scenario === 'invalid_compare') input.compare.behindBy = 1
    if (scenario === 'duplicate_commit') {
      input.compare.commits.push(input.compare.commits[0])
      input.compare.totalCommits = 4
      input.compare.aheadBy = 4
    }
    if (scenario === 'unmerged_child') child.mergedAt = null

    expect(assessRepositoryDeliveryInterval(input).commits[1]).toMatchObject({
      status: scenario === 'invalid_compare' ? 'unknown' : 'not_covered',
      reason: scenario === 'invalid_compare' ? 'invalid_comparison_range' : 'no_default_branch_pull_request',
      pullRequestNumber: null,
    })
  })

  it.each(['missing', 'stale'] as const)(
    'still requires the child review when the merge path is proven: %s',
    (review) => {
      const input = parentFirstStack()
      const child = input.pullRequestsByNumber[234]
      if (!child) throw new Error('Missing child fixture')
      child.reviews =
        review === 'missing'
          ? []
          : [
              {
                ...approvedPullRequest[42].reviews[0],
                submittedAt: '2026-09-17T10:47:20Z',
                commitId: null,
              },
            ]

      expect(assessRepositoryDeliveryInterval(input).commits[1]).toMatchObject({
        pullRequestNumber: 234,
        status: 'not_covered',
        reason: review === 'missing' ? 'no_approved_reviews' : 'approval_before_last_commit',
      })
    },
  )

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
          headSha: '9'.repeat(40),
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
      stackParentPullRequestNumbersByNumber: { 43: [42] },
      stackAncestryByPullRequestNumber: { 43: { 42: 'ahead' } },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'covered',
      reason: 'approved_review',
      pullRequestNumber: 43,
    })
  })

  it('handles a merge commit when a stacked PR base branch contains regex characters', () => {
    const mergeCommitSha = '7'.repeat(40)
    const stackedPullRequest = {
      ...approvedPullRequest[42],
      number: 43,
      baseBranch: 'feature/stack(1',
      headBranch: 'feature/stack(2',
      headSha: mergeCommitSha,
      mergeCommitSha: '5'.repeat(40),
      mergedAt: '2026-10-01T13:00:00Z',
      commitCount: 2,
      commits: [
        prCommit,
        {
          ...prCommit,
          sha: mergeCommitSha,
          message: "Merge branch 'feature/stack(1' into feature/stack(2)",
          authorDate: '2026-10-01T12:00:00Z',
          committerDate: '2026-10-01T12:00:00Z',
          isMergeCommit: true,
          parentShas: [commitSha, '8'.repeat(40)],
        },
      ],
    }
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [{ number: 43, baseBranch: 'feature/stack(1' }],
        },
      },
      pullRequestsByNumber: {
        42: {
          ...approvedPullRequest[42],
          number: 42,
          baseBranch: 'main',
          headBranch: 'feature/stack(1',
          headSha: '9'.repeat(40),
          mergeCommitSha: '4'.repeat(40),
          mergedAt: '2026-10-01T12:00:00Z',
        },
        43: stackedPullRequest,
      },
      stackParentPullRequestNumbersByNumber: { 43: [42] },
      stackAncestryByPullRequestNumber: { 43: { 42: 'ahead' } },
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
      stackParentPullRequestNumbersByNumber: { 43: [] },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'not_covered',
      reason: 'no_default_branch_pull_request',
    })
  })

  it('keeps stack evidence unknown when parent discovery or ancestry evidence is incomplete', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [{ number: 43, baseBranch: 'feature/base' }],
        },
      },
      pullRequestsByNumber: {
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
      stackParentPullRequestNumbersByNumber: { 43: [42] },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'unknown',
      reason: 'incomplete_stack_evidence',
      pullRequestNumber: 43,
    })
    expect(result.state).toBe('incomplete')
  })

  it('preserves unknown stack evidence when another PR candidate is unapproved', () => {
    const result = assess({
      associatedPullRequestsByCommit: {
        [commitSha]: {
          complete: true,
          pullRequests: [
            { number: 41, baseBranch: 'main' },
            { number: 43, baseBranch: 'feature/base' },
          ],
        },
      },
      pullRequestsByNumber: {
        41: { ...approvedPullRequest[42], number: 41, reviews: [] },
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
      stackParentPullRequestNumbersByNumber: { 43: [42] },
    })
    expect(result.commits[0]).toMatchObject({
      status: 'unknown',
      reason: 'incomplete_stack_evidence',
    })
  })

  it('does not cover a stack when the child merge commit is not an ancestor of its parent merge', () => {
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
          headSha: '9'.repeat(40),
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
      stackParentPullRequestNumbersByNumber: { 43: [42] },
      stackAncestryByPullRequestNumber: { 43: { 42: 'diverged' } },
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
