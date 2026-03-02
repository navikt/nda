import { describe, expect, it } from 'vitest'
import {
  canExplainUnverifiedByBaseMerge,
  isBaseBranchMergeCommit,
  shouldApproveWithBaseMerge,
} from '../base-branch-merge'

/**
 * Tests for handling base branch (main) merged into feature branch.
 *
 * Scenario: PR is approved, then main is merged INTO the feature branch
 * before the PR is merged to main. The deployment should still be considered
 * approved because:
 * 1. The PR has a valid approval
 * 2. The "extra" commits are from main (already approved via their own PRs)
 *
 * Test data based on real PR (anonymized):
 * - PR author: userA
 * - PR approver: userB
 * - Original commits: 2 commits by userA
 * - Then main was merged into branch, bringing 4 commits from other PRs
 * - Total: 6 commits in PR
 * - PR was merged by userA
 */

// Mock PR data structure
interface MockPRData {
  number: number
  title: string
  user: { login: string }
  merged_by: { login: string }
  base: { ref: string }
  head: { sha: string }
  merge_commit_sha: string
  merged_at: string
}

// Mock commit data
interface MockCommit {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
}

// Mock review data
interface MockReview {
  user: { login: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  submitted_at: string
  commit_id: string
}

// Test data - anonymized from real PR #15277
const mockDeployedPR: MockPRData = {
  number: 100,
  title: 'Feature/add new option',
  user: { login: 'userA' },
  merged_by: { login: 'userA' },
  base: { ref: 'main' },
  head: { sha: 'ef504d6' }, // Last commit (merge commit bringing main into branch)
  merge_commit_sha: '22999f4',
  merged_at: '2025-02-26T11:14:01Z',
}

// The PR was approved BEFORE main was merged into the branch
const mockReviews: MockReview[] = [
  {
    user: { login: 'userB' },
    state: 'APPROVED',
    submitted_at: '2025-02-24T10:24:37Z',
    commit_id: 'ef504d6', // GitHub updates this to head commit
  },
]

// Commits in the PR after main was merged into branch
const mockPRCommits: MockCommit[] = [
  // Original feature commits (by PR author)
  {
    sha: 'aaa1111',
    message: 'Add new option to enum',
    author: 'userA',
    date: '2025-02-24T06:44:00Z',
    html_url: 'https://github.com/org/repo/commit/aaa1111',
  },
  {
    sha: 'bbb2222',
    message: 'Sort options alphabetically',
    author: 'userA',
    date: '2025-02-24T06:45:00Z',
    html_url: 'https://github.com/org/repo/commit/bbb2222',
  },
  // Commits from main (merged into branch on 2025-02-26)
  {
    sha: 'ccc3333',
    message: 'Merge pull request #98 from org/other-feature',
    author: 'userC',
    date: '2025-02-25T09:00:00Z',
    html_url: 'https://github.com/org/repo/commit/ccc3333',
  },
  {
    sha: 'ddd4444',
    message: 'Fix date handling',
    author: 'userD',
    date: '2025-02-25T10:00:00Z',
    html_url: 'https://github.com/org/repo/commit/ddd4444',
  },
  {
    sha: 'eee5555',
    message: 'Update dependencies',
    author: 'userE',
    date: '2025-02-26T08:00:00Z',
    html_url: 'https://github.com/org/repo/commit/eee5555',
  },
  // The merge commit bringing main into the feature branch
  {
    sha: 'ef504d6',
    message: "Merge branch 'main' into feature/add-new-option",
    author: 'userA',
    date: '2025-02-26T10:33:54Z',
    html_url: 'https://github.com/org/repo/commit/ef504d6',
  },
]

describe('Base branch merge detection', () => {
  describe('isBaseBranchMergeCommit', () => {
    it('should detect standard main merge', () => {
      expect(isBaseBranchMergeCommit("Merge branch 'main' into feature/add-option")).toBe(true)
    })

    it('should detect master merge', () => {
      expect(isBaseBranchMergeCommit("Merge branch 'master' into feature/add-option")).toBe(true)
    })

    it('should detect remote tracking branch merge', () => {
      expect(isBaseBranchMergeCommit("Merge remote-tracking branch 'origin/main' into feature/x")).toBe(true)
    })

    it('should not detect PR merge commits', () => {
      expect(isBaseBranchMergeCommit('Merge pull request #98 from org/other-feature')).toBe(false)
    })

    it('should not detect regular commits', () => {
      expect(isBaseBranchMergeCommit('Add new feature')).toBe(false)
    })

    it('should be case insensitive', () => {
      expect(isBaseBranchMergeCommit("merge branch 'MAIN' into feature/x")).toBe(true)
    })
  })

  describe('canExplainUnverifiedByBaseMerge', () => {
    it('should return true when no unverified commits', () => {
      const result = canExplainUnverifiedByBaseMerge([], mockPRCommits)
      expect(result.canExplain).toBe(true)
      expect(result.reason).toBe('no_unverified_commits')
    })

    it('should return false when no merge commit found', () => {
      const commitsWithoutMerge = mockPRCommits.filter((c) => !isBaseBranchMergeCommit(c.message))
      const unverified = [mockPRCommits[2]] // A commit from main

      const result = canExplainUnverifiedByBaseMerge(unverified, commitsWithoutMerge)
      expect(result.canExplain).toBe(false)
      expect(result.reason).toBe('no_base_merge_commit_found')
    })

    it('should explain commits from base branch (before merge date)', () => {
      // Commits ccc3333, ddd4444, eee5555 are from main (dates before merge on 2025-02-26T10:33:54Z)
      const unverified = mockPRCommits.filter((c) => ['ccc3333', 'ddd4444', 'eee5555', 'ef504d6'].includes(c.sha))

      const result = canExplainUnverifiedByBaseMerge(unverified, mockPRCommits)
      expect(result.canExplain).toBe(true)
      expect(result.reason).toBe('all_unverified_from_base_branch')
      expect(result.mergeCommitSha).toBe('ef504d6')
    })

    it('should not explain commits made after the merge', () => {
      // Create a fake commit after the merge date
      const postMergeCommit: MockCommit = {
        sha: 'fff6666',
        message: 'Direct push after merge',
        author: 'userX',
        date: '2025-02-26T11:00:00Z', // After merge at 10:33:54
        html_url: 'https://github.com/org/repo/commit/fff6666',
      }

      const allCommits = [...mockPRCommits, postMergeCommit]
      const unverified = [postMergeCommit]

      const result = canExplainUnverifiedByBaseMerge(unverified, allCommits)
      expect(result.canExplain).toBe(false)
      expect(result.reason).toContain('fff6666')
      expect(result.reason).toContain('after_merge')
    })
  })

  describe('shouldApproveWithBaseMerge', () => {
    it('should approve when PR is approved and unverified are from base merge', () => {
      const unverified = mockPRCommits.filter((c) => ['ccc3333', 'ddd4444', 'eee5555', 'ef504d6'].includes(c.sha))

      const result = shouldApproveWithBaseMerge(mockReviews, unverified, mockPRCommits, mockDeployedPR.base.ref)

      expect(result.approved).toBe(true)
      expect(result.reason).toContain('approved_with_base_merge')
    })

    it('should not approve when no reviews', () => {
      const unverified = mockPRCommits.filter((c) => c.sha === 'ccc3333')

      const result = shouldApproveWithBaseMerge([], unverified, mockPRCommits, mockDeployedPR.base.ref)

      expect(result.approved).toBe(false)
      expect(result.reason).toBe('no_approval')
    })

    it('should not approve when only COMMENTED reviews exist', () => {
      const commentedReview: MockReview = {
        user: { login: 'userB' },
        state: 'COMMENTED',
        submitted_at: '2025-02-24T10:24:37Z',
        commit_id: 'ef504d6',
      }

      const unverified = mockPRCommits.filter((c) => c.sha === 'ccc3333')

      const result = shouldApproveWithBaseMerge([commentedReview], unverified, mockPRCommits, mockDeployedPR.base.ref)

      expect(result.approved).toBe(false)
      expect(result.reason).toBe('no_approval')
    })

    it('should not approve when unverified commits cannot be explained', () => {
      // Simulate commits without a merge commit to bring them in
      const commitsWithoutMerge = mockPRCommits.filter((c) => !isBaseBranchMergeCommit(c.message))
      const unverified = [mockPRCommits[2]] // ccc3333 from main

      const result = shouldApproveWithBaseMerge(mockReviews, unverified, commitsWithoutMerge, mockDeployedPR.base.ref)

      expect(result.approved).toBe(false)
    })

    it('should handle scenario from real PR #15277', () => {
      // This is the real scenario: PR was approved, then main was merged in
      // The 4 unverified commits (3 from main + 1 merge commit) should be explained

      const unverifiedFromMain = mockPRCommits.filter((c) =>
        // These are the commits that came from main + the merge commit
        ['ccc3333', 'ddd4444', 'eee5555', 'ef504d6'].includes(c.sha),
      )

      const result = shouldApproveWithBaseMerge(mockReviews, unverifiedFromMain, mockPRCommits, mockDeployedPR.base.ref)

      expect(result.approved).toBe(true)
      expect(result.reason).toBe('approved_with_base_merge:ef504d6')
    })
  })

  describe('isBaseBranchMergeCommit edge cases', () => {
    it('should handle multiple merge patterns from real-world scenario', () => {
      // From the actual PR #15277, there were multiple merge commits
      expect(isBaseBranchMergeCommit("Merge branch 'main' into feature/kravArsakKodeENDRET_OPPTJENING")).toBe(true)
      expect(isBaseBranchMergeCommit('Merge pull request #15277 from navikt/feature/krav')).toBe(false)
    })

    it('should handle partial commit messages (truncated)', () => {
      // Console logs often truncate commit messages
      expect(isBaseBranchMergeCommit("Merge branch 'main' into feature/kravArsakKodeENDR")).toBe(true)
    })
  })

  /**
   * Edge cases for missing date fields in merge commits and regular commits.
   *
   * WHY: Squash-merge and legacy commits from GitHub sometimes lack the 'date' field.
   * When this happens, canExplainUnverifiedByBaseMerge falls back to position-based
   * checking (commit index in the PR commit list). These tests cover lines 74-89
   * (merge commit without date) and 107-116 (regular commit without date).
   * Without these, a refactor could break the fallback logic silently.
   */
  describe('canExplainUnverifiedByBaseMerge — no-date fallback (position-based)', () => {
    it('explains commits when merge commit has no date and unverified appear before it', () => {
      const prCommits = [
        { sha: 'aaa', message: 'Feature commit', author: 'alice', date: '2025-01-01' },
        { sha: 'bbb', message: 'From main', author: 'bob' }, // no date
        { sha: 'merge1', message: "Merge branch 'main' into feature/x", author: 'alice' }, // no date
      ]
      const unverified = [
        { sha: 'bbb', message: 'From main', author: 'bob' },
        { sha: 'merge1', message: "Merge branch 'main' into feature/x", author: 'alice' },
      ]

      const result = canExplainUnverifiedByBaseMerge(unverified, prCommits)
      expect(result.canExplain).toBe(true)
      expect(result.reason).toBe('all_unverified_from_base_branch')
      expect(result.mergeCommitSha).toBe('merge1')
    })

    it('rejects when merge commit has no date and unverified appears AFTER merge in list', () => {
      const prCommits = [
        { sha: 'aaa', message: 'Feature commit', author: 'alice' },
        { sha: 'merge1', message: "Merge branch 'main' into feature/x", author: 'alice' }, // no date
        { sha: 'suspicious', message: 'Added after merge', author: 'mallory' }, // after merge
      ]
      const unverified = [{ sha: 'suspicious', message: 'Added after merge', author: 'mallory' }]

      const result = canExplainUnverifiedByBaseMerge(unverified, prCommits)
      expect(result.canExplain).toBe(false)
      expect(result.reason).toContain('suspici')
      expect(result.reason).toContain('after_merge_in_list')
    })

    it('handles regular commit without date that appears before merge (position check)', () => {
      const prCommits = [
        { sha: 'no-date', message: 'Old commit', author: 'bob' }, // no date, index 0
        { sha: 'merge1', message: "Merge branch 'main' into feature/x", author: 'alice', date: '2025-02-01' },
      ]
      const unverified = [{ sha: 'no-date', message: 'Old commit', author: 'bob' }]

      const result = canExplainUnverifiedByBaseMerge(unverified, prCommits)
      expect(result.canExplain).toBe(true)
    })

    it('rejects regular commit without date that appears after merge (position check)', () => {
      const prCommits = [
        { sha: 'merge1', message: "Merge branch 'main' into feature/x", author: 'alice', date: '2025-02-01' },
        { sha: 'no-date', message: 'Snuck in', author: 'mallory' }, // no date, after merge
      ]
      const unverified = [{ sha: 'no-date', message: 'Snuck in', author: 'mallory' }]

      const result = canExplainUnverifiedByBaseMerge(unverified, prCommits)
      expect(result.canExplain).toBe(false)
      expect(result.reason).toContain('position_unknown')
    })

    it('rejects regular commit without date that is not found in PR commits at all', () => {
      const prCommits = [
        { sha: 'merge1', message: "Merge branch 'main' into feature/x", author: 'alice', date: '2025-02-01' },
      ]
      const unverified = [{ sha: 'unknown', message: 'Not in PR', author: 'ghost' }]

      const result = canExplainUnverifiedByBaseMerge(unverified, prCommits)
      expect(result.canExplain).toBe(false)
      expect(result.reason).toContain('position_unknown')
    })
  })
})
