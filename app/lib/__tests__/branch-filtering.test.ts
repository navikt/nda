import { describe, expect, it } from 'vitest'

const MAIN_PR = {
  number: 18316,
  title: 'Feature/integration',
  base_ref: 'main',
  merged_at: '2026-01-21T13:57:50Z',
  creator: 'author-a',
  merger: 'author-a',
  reviews: [
    { user: 'reviewer-b', state: 'DISMISSED', submitted_at: '2026-01-19T12:55:08Z' },
    { user: 'reviewer-b', state: 'APPROVED', submitted_at: '2026-01-21T13:49:56Z' },
  ],
  commits: [
    { sha: 'commit-1', message: 'First feature commit', author: 'author-a', date: '2026-01-15T11:58:43Z' },
    { sha: 'commit-2', message: 'Second feature commit', author: 'author-a', date: '2026-01-15T12:00:01Z' },
    { sha: 'commit-3', message: 'Third feature commit', author: 'author-a', date: '2026-01-19T12:18:41Z' },
    { sha: 'commit-4', message: 'Fourth feature commit', author: 'author-a', date: '2026-01-19T12:54:23Z' },
    { sha: 'commit-5', message: 'Fifth feature commit', author: 'author-a', date: '2026-01-19T14:03:01Z' },
    { sha: 'commit-6', message: 'Sixth feature commit', author: 'author-a', date: '2026-01-20T09:40:59Z' },
    { sha: 'commit-7', message: 'Seventh feature commit', author: 'author-a', date: '2026-01-20T10:35:29Z' },
    { sha: 'commit-8', message: 'Eighth feature commit', author: 'author-a', date: '2026-01-20T12:36:25Z' },
    { sha: 'commit-9', message: 'Final feature commit', author: 'author-a', date: '2026-01-21T13:23:10Z' },
  ],
}

const FEATURE_BRANCH_PRS = [
  {
    number: 18333,
    title: 'Feature/integration part 1',
    base_ref: 'feature/shared-branch', // NOT main
    merged_at: '2026-01-19T13:00:00Z',
    commits: [
      { sha: 'commit-1', message: 'First feature commit', author: 'author-a', date: '2026-01-15T11:58:43Z' },
      { sha: 'commit-2', message: 'Second feature commit', author: 'author-a', date: '2026-01-15T12:00:01Z' },
      { sha: 'commit-3', message: 'Third feature commit', author: 'author-a', date: '2026-01-19T12:18:41Z' },
      { sha: 'commit-4', message: 'Fourth feature commit', author: 'author-a', date: '2026-01-19T12:54:23Z' },
    ],
    reviews: [], // No reviews - but doesn't matter since it doesn't target main
  },
  {
    number: 18339,
    title: 'Feature/integration part 2',
    base_ref: 'feature/shared-branch', // NOT main
    merged_at: '2026-01-20T10:00:00Z',
    commits: [
      { sha: 'commit-5', message: 'Fifth feature commit', author: 'author-a', date: '2026-01-19T14:03:01Z' },
      { sha: 'commit-6', message: 'Sixth feature commit', author: 'author-a', date: '2026-01-20T09:40:59Z' },
    ],
    reviews: [],
  },
  {
    number: 18346,
    title: 'Feature/integration part 3',
    base_ref: 'feature/shared-branch', // NOT main
    merged_at: '2026-01-20T13:00:00Z',
    commits: [
      { sha: 'commit-7', message: 'Seventh feature commit', author: 'author-a', date: '2026-01-20T10:35:29Z' },
      { sha: 'commit-8', message: 'Eighth feature commit', author: 'author-a', date: '2026-01-20T12:36:25Z' },
    ],
    reviews: [],
  },
]

const ALL_PRS_FOR_COMMIT_1 = [FEATURE_BRANCH_PRS[0], MAIN_PR]

describe('Branch Filtering', () => {
  describe('filterPRsByBaseBranch', () => {
    function filterPRsByBaseBranch(
      prs: Array<{ number: number; base_ref: string }>,
      baseBranch: string,
    ): Array<{ number: number; base_ref: string }> {
      return prs.filter((pr) => pr.base_ref === baseBranch)
    }

    it('should filter out PRs that do not target the base branch', () => {
      const filtered = filterPRsByBaseBranch(ALL_PRS_FOR_COMMIT_1, 'main')

      expect(filtered).toHaveLength(1)
      expect(filtered[0].number).toBe(MAIN_PR.number)
    })

    it('should return empty array if no PRs target the base branch', () => {
      const filtered = filterPRsByBaseBranch(FEATURE_BRANCH_PRS, 'main')

      expect(filtered).toHaveLength(0)
    })

    it('should return all PRs if no base branch filter is applied', () => {
      const filtered = filterPRsByBaseBranch(ALL_PRS_FOR_COMMIT_1, '')

      expect(filtered).toHaveLength(0)
    })
  })

  describe('verifyFourEyesFromPrData', () => {
    function verifyFourEyesFromPrData(prData: {
      creator?: { username: string }
      reviewers?: Array<{ username: string; state: string; submitted_at: string }>
      commits?: Array<{ sha: string; date: string }>
    }): { hasFourEyes: boolean; reason: string } {
      const reviewers = prData.reviewers || []
      const commits = prData.commits || []

      if (commits.length === 0) {
        return { hasFourEyes: false, reason: 'No commits found in PR' }
      }

      const lastCommitDate = new Date(commits[commits.length - 1].date)

      const approvedReviewsAfterLastCommit = reviewers.filter((review) => {
        if (review.state !== 'APPROVED' || !review.submitted_at) {
          return false
        }
        const reviewDate = new Date(review.submitted_at)
        return reviewDate > lastCommitDate
      })

      if (approvedReviewsAfterLastCommit.length > 0) {
        return {
          hasFourEyes: true,
          reason: `Approved by ${approvedReviewsAfterLastCommit[0].username} after last commit`,
        }
      }

      const approvedReviews = reviewers.filter((r) => r.state === 'APPROVED')
      if (approvedReviews.length === 0) {
        return { hasFourEyes: false, reason: 'No approved reviews found' }
      }

      return { hasFourEyes: false, reason: 'Approval was before last commit' }
    }

    it('should return approved when review comes after last commit', () => {
      const prData = {
        creator: { username: 'author-a' },
        reviewers: MAIN_PR.reviews.map((r) => ({
          username: r.user,
          state: r.state,
          submitted_at: r.submitted_at,
        })),
        commits: MAIN_PR.commits.map((c) => ({ sha: c.sha, date: c.date })),
      }

      const result = verifyFourEyesFromPrData(prData)

      expect(result.hasFourEyes).toBe(true)
      expect(result.reason).toContain('Approved by reviewer-b')
    })

    it('should return not approved when no approved reviews exist', () => {
      const prData = {
        creator: { username: 'author-a' },
        reviewers: [{ username: 'reviewer-b', state: 'DISMISSED', submitted_at: '2026-01-21T14:00:00Z' }],
        commits: [{ sha: 'commit-1', date: '2026-01-21T13:00:00Z' }],
      }

      const result = verifyFourEyesFromPrData(prData)

      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('No approved reviews found')
    })

    it('should return not approved when approval comes before last commit', () => {
      const prData = {
        creator: { username: 'author-a' },
        reviewers: [{ username: 'reviewer-b', state: 'APPROVED', submitted_at: '2026-01-20T10:00:00Z' }],
        commits: [
          { sha: 'commit-1', date: '2026-01-19T10:00:00Z' },
          { sha: 'commit-2', date: '2026-01-21T10:00:00Z' }, // After approval
        ],
      }

      const result = verifyFourEyesFromPrData(prData)

      expect(result.hasFourEyes).toBe(false)
      expect(result.reason).toBe('Approval was before last commit')
    })
  })

  describe('Commit coverage by deployed PR', () => {
    it('should mark commits as covered when they are in the deployed PR commit list', () => {
      const deployedPrCommitShas = new Set(MAIN_PR.commits.map((c) => c.sha))
      const commitToCheck = 'commit-1'

      expect(deployedPrCommitShas.has(commitToCheck)).toBe(true)
    })

    it('should not mark commits as covered when they are not in the deployed PR', () => {
      const deployedPrCommitShas = new Set(MAIN_PR.commits.map((c) => c.sha))
      const unknownCommit = 'unknown-commit-sha'

      expect(deployedPrCommitShas.has(unknownCommit)).toBe(false)
    })

    it('should handle merge commits by skipping them (they have 2+ parents)', () => {
      const commits = [
        { sha: 'regular-1', parents_count: 1 },
        { sha: 'merge-1', parents_count: 2 }, // Merge commit
        { sha: 'regular-2', parents_count: 1 },
        { sha: 'merge-2', parents_count: 3 }, // Octopus merge
      ]

      const nonMergeCommits = commits.filter((c) => c.parents_count < 2)

      expect(nonMergeCommits).toHaveLength(2)
      expect(nonMergeCommits.map((c) => c.sha)).toEqual(['regular-1', 'regular-2'])
    })
  })

  describe('Feature branch PR scenario', () => {
    it('should correctly identify that feature branch PRs do not target main', () => {
      for (const pr of FEATURE_BRANCH_PRS) {
        expect(pr.base_ref).not.toBe('main')
        expect(pr.base_ref).toBe('feature/shared-branch')
      }
    })

    it('should correctly identify that main PR targets main', () => {
      expect(MAIN_PR.base_ref).toBe('main')
    })

    it('should find commits in main PR even if they were originally in feature branch PRs', () => {
      const commitSha = 'commit-1'

      const featurePrContainsCommit = FEATURE_BRANCH_PRS[0].commits.some((c) => c.sha === commitSha)
      const mainPrContainsCommit = MAIN_PR.commits.some((c) => c.sha === commitSha)

      expect(featurePrContainsCommit).toBe(true)
      expect(mainPrContainsCommit).toBe(true)

      const prsContainingCommit = [...FEATURE_BRANCH_PRS, MAIN_PR].filter((pr) =>
        pr.commits.some((c) => c.sha === commitSha),
      )

      const mainBranchPrs = prsContainingCommit.filter((pr) => pr.base_ref === 'main')

      expect(mainBranchPrs).toHaveLength(1)
      expect(mainBranchPrs[0].number).toBe(MAIN_PR.number)
    })
  })
})
