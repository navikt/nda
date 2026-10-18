import { describe, expect, it } from 'vitest'
import { assessRepositoryDeliveryApproval } from '~/lib/repository-code-delivery/approval-assessment'

const baseSha = '0'.repeat(40)
const commitASha = 'a'.repeat(40)
const commitBSha = 'b'.repeat(40)
const outsideSha = 'c'.repeat(40)
const headSha = commitASha

function assess(overrides: Partial<Parameters<typeof assessRepositoryDeliveryApproval>[0]> = {}) {
  return assessRepositoryDeliveryApproval({
    baseSha,
    headSha,
    commitHistoryComplete: true,
    totalCommits: 1,
    commits: [{ sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'not_approved' }],
    approvals: [],
    ...overrides,
  })
}

describe('repository code delivery approval assessment', () => {
  it('counts a PR approved by existing NDA rules as covered', () => {
    expect(
      assess({
        commits: [{ sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'approved' }],
      }),
    ).toMatchObject({
      status: 'approved',
      commits: [{ sha: commitASha, status: 'covered', reason: 'approved_pr' }],
    })
  })

  it('allows an approver who is not the commit author to approve a direct commit', () => {
    expect(
      assess({
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'approved',
      commits: [{ sha: commitASha, status: 'covered', reason: 'manual_approval' }],
    })
  })

  it('does not allow a commit author to approve their own commit', () => {
    expect(
      assess({
        approvals: [{ approverIdentityKey: 'author-a', commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'not_approved',
      commits: [{ sha: commitASha, status: 'not_covered', reason: 'missing_approval' }],
    })
  })

  it('allows two commit authors to approve each other’s commits', () => {
    expect(
      assess({
        totalCommits: 2,
        headSha: commitBSha,
        commits: [
          { sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'not_approved' },
          { sha: commitBSha, authorIdentityKey: 'author-b', prCoverage: 'not_approved' },
        ],
        approvals: [
          { approverIdentityKey: 'author-b', commitShas: [commitASha] },
          { approverIdentityKey: 'author-a', commitShas: [commitBSha] },
        ],
      }),
    ).toMatchObject({
      status: 'approved',
      commits: [
        { sha: commitASha, status: 'covered', reason: 'manual_approval' },
        { sha: commitBSha, status: 'covered', reason: 'manual_approval' },
      ],
    })
  })

  it('does not let one of two commit authors approve the whole interval alone', () => {
    expect(
      assess({
        totalCommits: 2,
        headSha: commitBSha,
        commits: [
          { sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'not_approved' },
          { sha: commitBSha, authorIdentityKey: 'author-b', prCoverage: 'not_approved' },
        ],
        approvals: [{ approverIdentityKey: 'author-a', commitShas: [commitASha, commitBSha] }],
      }),
    ).toMatchObject({
      status: 'not_approved',
      commits: [
        { sha: commitASha, status: 'not_covered' },
        { sha: commitBSha, status: 'covered' },
      ],
    })
  })

  it('allows one external approver to cover the whole interval', () => {
    expect(
      assess({
        totalCommits: 2,
        headSha: commitBSha,
        commits: [
          { sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'not_approved' },
          { sha: commitBSha, authorIdentityKey: 'author-b', prCoverage: 'not_approved' },
        ],
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [commitASha, commitBSha] }],
      }),
    ).toMatchObject({
      status: 'approved',
      commits: [
        { sha: commitASha, status: 'covered' },
        { sha: commitBSha, status: 'covered' },
      ],
    })
  })

  it('can combine an already approved PR with a manual approval for another commit', () => {
    expect(
      assess({
        totalCommits: 2,
        headSha: commitBSha,
        commits: [
          { sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'approved' },
          { sha: commitBSha, authorIdentityKey: 'author-b', prCoverage: 'not_approved' },
        ],
        approvals: [{ approverIdentityKey: 'author-a', commitShas: [commitBSha] }],
      }),
    ).toMatchObject({
      status: 'approved',
      commits: [
        { sha: commitASha, status: 'covered', reason: 'approved_pr' },
        { sha: commitBSha, status: 'covered', reason: 'manual_approval' },
      ],
    })
  })

  it('keeps incomplete PR evidence unknown even when there is a manual approval', () => {
    expect(
      assess({
        commits: [{ sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'unknown' }],
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'unknown_pr_coverage' }],
    })
  })

  it('keeps manual coverage unknown when the commit author identity is unavailable', () => {
    expect(
      assess({
        commits: [{ sha: commitASha, authorIdentityKey: null, prCoverage: 'not_approved' }],
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'unknown_commit_author' }],
    })
  })

  it('keeps coverage unknown when an approval has no resolvable approver identity', () => {
    expect(
      assess({
        approvals: [{ approverIdentityKey: null, commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'unknown_approver_identity' }],
    })
  })

  it('does not approve an interval when the GitHub commit history is incomplete', () => {
    expect(
      assess({
        commitHistoryComplete: false,
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'incomplete_commit_history' }],
    })
  })

  it('does not approve an interval when the commit count does not match the history', () => {
    expect(
      assess({
        totalCommits: 2,
        headSha: commitBSha,
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [commitASha] }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      omittedCommits: 1,
      commits: [{ status: 'unknown', reason: 'incomplete_commit_history' }],
    })
  })

  it('keeps the assessment unknown when the total commit count is unavailable', () => {
    expect(
      assess({
        totalCommits: null,
      }),
    ).toMatchObject({
      status: 'incomplete',
      totalCommits: null,
      commits: [{ status: 'unknown', reason: 'incomplete_commit_history' }],
    })
  })

  it('does not apply an approval to a commit outside the interval', () => {
    expect(
      assess({
        approvals: [{ approverIdentityKey: 'reviewer-x', commitShas: [outsideSha] }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'approval_outside_interval' }],
    })
  })

  it('does not treat an empty interval as an approval', () => {
    expect(
      assess({
        baseSha: headSha,
        headSha,
        totalCommits: 0,
        commits: [],
      }),
    ).toMatchObject({
      status: 'no_changes',
      totalCommits: 0,
    })
  })

  it('does not approve a complete history that omits its head commit', () => {
    expect(
      assess({
        headSha: outsideSha,
        commits: [{ sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'approved' }],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'invalid_interval' }],
    })
  })

  it('does not approve a complete history that includes its excluded base commit', () => {
    expect(
      assess({
        baseSha: commitASha,
        headSha: commitBSha,
        totalCommits: 2,
        commits: [
          { sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'approved' },
          { sha: commitBSha, authorIdentityKey: 'author-b', prCoverage: 'approved' },
        ],
      }),
    ).toMatchObject({
      status: 'incomplete',
      commits: [
        { sha: commitASha, status: 'unknown', reason: 'invalid_interval' },
        { sha: commitBSha, status: 'unknown', reason: 'invalid_interval' },
      ],
    })
  })

  it('matches interval endpoints case-insensitively', () => {
    expect(
      assess({
        headSha: commitASha.toUpperCase(),
        commits: [{ sha: commitASha, authorIdentityKey: 'author-a', prCoverage: 'approved' }],
      }),
    ).toMatchObject({ status: 'approved' })
  })
})
