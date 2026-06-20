import { describe, expect, it } from 'vitest'

const COMMITS_BETWEEN_DEPLOYMENTS = [
  {
    sha: 'edf1b1ff84ae3e508fa989c189a62ecbf44dd5aa',
    message: 'Feature commit from unapproved PR',
    author: 'user-a',
    date: '2026-01-25T10:00:00Z',
    parents: [{ sha: 'parent-1' }], // Single parent = regular commit
  },
  {
    sha: '16708b817e1d16f34168b1f79d62e54aa5941592',
    message: 'Another commit from unapproved PR',
    author: 'user-a',
    date: '2026-01-25T10:30:00Z',
    parents: [{ sha: 'parent-2' }],
  },
  {
    sha: 'e9ba01f37fdde990718fbdc66ae3713a392f7a2e',
    message: 'Commit in approved PR',
    author: 'user-b',
    date: '2026-01-26T09:00:00Z',
    parents: [{ sha: 'parent-3' }],
  },
  {
    sha: 'dbcb7c23209a5db6236dbdf50b6e1abe341002b5',
    message: 'Another commit in approved PR',
    author: 'user-b',
    date: '2026-01-26T09:30:00Z',
    parents: [{ sha: 'parent-4' }],
  },
  {
    sha: 'e15cc90', // Merge commit - should be skipped
    message: 'Merge branch main into feature',
    author: 'user-b',
    date: '2026-01-26T10:00:00Z',
    parents: [{ sha: 'parent-5' }, { sha: 'parent-6' }], // Two parents = merge
  },
  {
    sha: 'f92ec18', // Merge commit from unapproved PR - should be skipped
    message: 'Merge branch unapproved-feature',
    author: 'user-a',
    date: '2026-01-26T10:30:00Z',
    parents: [{ sha: '6bbecc1' }, { sha: '16708b8' }],
  },
  {
    sha: '55a83e761bcd32917d4d79bb892ff143951ecd8f',
    message: 'Revert "Merge branch unapproved-feature"',
    author: 'user-a',
    date: '2026-01-26T10:35:00Z',
    parents: [{ sha: 'parent-7' }], // Direct push to main - no PR
  },
  {
    sha: 'aea7a45ab704b32d7294eb966f10a06acf2a8be1', // Merge commit - should be skipped
    message: 'Merge pull request #18220',
    author: 'user-b',
    date: '2026-01-26T11:00:00Z',
    parents: [{ sha: 'parent-8' }, { sha: 'parent-9' }],
  },
]

const APPROVED_PR = {
  number: 18220,
  title: 'Feature: Approved changes',
  state: 'closed',
  merged: true,
  base_ref: 'main',
  creator: 'user-b',
  commits: [
    { sha: 'e9ba01f37fdde990718fbdc66ae3713a392f7a2e' },
    { sha: 'dbcb7c23209a5db6236dbdf50b6e1abe341002b5' },
    { sha: 'e15cc90' }, // merge commit in PR
  ],
  reviews: [{ user: 'reviewer-c', state: 'APPROVED', submitted_at: '2026-01-26T10:50:00Z' }],
}

const UNAPPROVED_PR = {
  number: 18196,
  title: 'Feature: Unapproved changes',
  state: 'closed',
  merged: true,
  base_ref: 'main',
  creator: 'user-a',
  commits: [{ sha: 'edf1b1ff84ae3e508fa989c189a62ecbf44dd5aa' }, { sha: '16708b817e1d16f34168b1f79d62e54aa5941592' }],
  reviews: [], // No reviews!
}

function getPRForCommit(sha: string, baseBranch: string): typeof APPROVED_PR | typeof UNAPPROVED_PR | null {
  if (APPROVED_PR.commits.some((c) => sha.startsWith(c.sha.substring(0, 7)))) {
    if (APPROVED_PR.base_ref === baseBranch) {
      return APPROVED_PR
    }
  }

  if (UNAPPROVED_PR.commits.some((c) => sha.startsWith(c.sha.substring(0, 7)))) {
    if (UNAPPROVED_PR.base_ref === baseBranch) {
      return UNAPPROVED_PR
    }
  }

  return null
}

function isPRApproved(pr: typeof APPROVED_PR | typeof UNAPPROVED_PR): boolean {
  return pr.reviews.some((r) => r.state === 'APPROVED')
}

function verifyCommit(
  commit: (typeof COMMITS_BETWEEN_DEPLOYMENTS)[0],
  deployedPR: typeof APPROVED_PR,
  baseBranch: string,
): { verified: boolean; reason: string; pr_number: number | null } {
  if (commit.parents.length >= 2) {
    return { verified: true, reason: 'merge_commit_skipped', pr_number: null }
  }

  const deployedPrCommitShas = new Set(deployedPR.commits.map((c) => c.sha))
  if (deployedPrCommitShas.has(commit.sha) && isPRApproved(deployedPR)) {
    return { verified: true, reason: 'in_approved_pr', pr_number: deployedPR.number }
  }

  const pr = getPRForCommit(commit.sha, baseBranch)

  if (!pr) {
    return { verified: false, reason: 'no_pr', pr_number: null }
  }

  if (isPRApproved(pr)) {
    return { verified: true, reason: 'pr_approved', pr_number: pr.number }
  }

  return { verified: false, reason: 'pr_not_approved', pr_number: pr.number }
}

describe('Direct Push and Unapproved PR Verification', () => {
  describe('Commit classification', () => {
    it('should identify merge commits (2+ parents)', () => {
      const mergeCommits = COMMITS_BETWEEN_DEPLOYMENTS.filter((c) => c.parents.length >= 2)

      expect(mergeCommits).toHaveLength(3)
      expect(mergeCommits.map((c) => c.sha.substring(0, 7))).toEqual(['e15cc90', 'f92ec18', 'aea7a45'])
    })

    it('should identify regular commits (1 parent)', () => {
      const regularCommits = COMMITS_BETWEEN_DEPLOYMENTS.filter((c) => c.parents.length < 2)

      expect(regularCommits).toHaveLength(5)
    })
  })

  describe('PR lookup', () => {
    it('should find approved PR for commits in PR #18220', () => {
      const pr = getPRForCommit('e9ba01f37fdde990718fbdc66ae3713a392f7a2e', 'main')

      expect(pr).not.toBeNull()
      expect(pr?.number).toBe(18220)
    })

    it('should find unapproved PR for commits in PR #18196', () => {
      const pr = getPRForCommit('edf1b1ff84ae3e508fa989c189a62ecbf44dd5aa', 'main')

      expect(pr).not.toBeNull()
      expect(pr?.number).toBe(18196)
    })

    it('should return null for direct push commit (revert)', () => {
      const pr = getPRForCommit('55a83e761bcd32917d4d79bb892ff143951ecd8f', 'main')

      expect(pr).toBeNull()
    })
  })

  describe('Commit verification', () => {
    it('should verify commits from approved PR #18220', () => {
      const commit = COMMITS_BETWEEN_DEPLOYMENTS.find((c) => c.sha.startsWith('e9ba01f'))
      if (!commit) throw new Error('Test data not found')
      const result = verifyCommit(commit, APPROVED_PR, 'main')

      expect(result.verified).toBe(true)
      expect(result.reason).toBe('in_approved_pr')
      expect(result.pr_number).toBe(18220)
    })

    it('should NOT verify commits from unapproved PR #18196', () => {
      const commit = COMMITS_BETWEEN_DEPLOYMENTS.find((c) => c.sha.startsWith('edf1b1f'))
      if (!commit) throw new Error('Test data not found')
      const result = verifyCommit(commit, APPROVED_PR, 'main')

      expect(result.verified).toBe(false)
      expect(result.reason).toBe('pr_not_approved')
      expect(result.pr_number).toBe(18196)
    })

    it('should NOT verify direct push revert commit (no PR)', () => {
      const commit = COMMITS_BETWEEN_DEPLOYMENTS.find((c) => c.sha.startsWith('55a83e7'))
      if (!commit) throw new Error('Test data not found')
      const result = verifyCommit(commit, APPROVED_PR, 'main')

      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_pr')
      expect(result.pr_number).toBeNull()
    })

    it('should skip merge commits', () => {
      const mergeCommit = COMMITS_BETWEEN_DEPLOYMENTS.find((c) => c.sha === 'e15cc90')
      if (!mergeCommit) throw new Error('Test data not found')
      const result = verifyCommit(mergeCommit, APPROVED_PR, 'main')

      expect(result.verified).toBe(true)
      expect(result.reason).toBe('merge_commit_skipped')
    })
  })

  describe('Full verification scenario', () => {
    it('should correctly identify 3 unverified commits in the deployment', () => {
      const results = COMMITS_BETWEEN_DEPLOYMENTS.map((commit) => ({
        sha: commit.sha.substring(0, 7),
        ...verifyCommit(commit, APPROVED_PR, 'main'),
      }))

      const unverifiedCommits = results.filter((r) => !r.verified)

      expect(unverifiedCommits).toHaveLength(3)
      expect(unverifiedCommits.map((c) => c.sha)).toEqual(['edf1b1f', '16708b8', '55a83e7'])
    })

    it('should have correct reasons for unverified commits', () => {
      const results = COMMITS_BETWEEN_DEPLOYMENTS.map((commit) => ({
        sha: commit.sha.substring(0, 7),
        ...verifyCommit(commit, APPROVED_PR, 'main'),
      }))

      const unverifiedCommits = results.filter((r) => !r.verified)

      expect(unverifiedCommits.filter((c) => c.reason === 'pr_not_approved')).toHaveLength(2)

      expect(unverifiedCommits.filter((c) => c.reason === 'no_pr')).toHaveLength(1)
    })

    it('should NOT cover unapproved commits with deployed PR approval', () => {
      const commitFromUnapprovedPR = COMMITS_BETWEEN_DEPLOYMENTS.find((c) => c.sha.startsWith('edf1b1f'))
      const directPushCommit = COMMITS_BETWEEN_DEPLOYMENTS.find((c) => c.sha.startsWith('55a83e7'))

      if (!commitFromUnapprovedPR || !directPushCommit) {
        throw new Error('Test data not found')
      }

      const result1 = verifyCommit(commitFromUnapprovedPR, APPROVED_PR, 'main')
      const result2 = verifyCommit(directPushCommit, APPROVED_PR, 'main')

      expect(result1.verified).toBe(false)
      expect(result2.verified).toBe(false)

      expect(result1.reason).not.toBe('covered_by_merge_pr')
      expect(result2.reason).not.toBe('covered_by_merge_pr')
    })
  })
})
