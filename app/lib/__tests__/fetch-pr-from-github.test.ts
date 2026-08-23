import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/github', () => ({
  getDetailedPullRequestInfo: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getDetailedPullRequestInfo } from '~/lib/github'
import { fetchPrFromGitHub } from '~/lib/verification/fetch-data/pr-data.server'

const mockGetDetailedPrInfo = getDetailedPullRequestInfo as ReturnType<typeof vi.fn>

describe('fetchPrFromGitHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the detailed PR data into the transformed snapshot shapes', async () => {
    mockGetDetailedPrInfo.mockResolvedValue({
      title: 'Fix calculation',
      body: 'Fixes the bug',
      labels: ['bug'],
      created_at: '2026-02-20T10:00:00Z',
      merged_at: '2026-02-25T14:30:00Z',
      base_branch: 'main',
      base_sha: 'abc123',
      head_branch: 'feature/x',
      head_sha: 'def456',
      merge_commit_sha: 'merge789',
      commits_count: 1,
      changed_files: 5,
      additions: 120,
      deletions: 40,
      comments_count: 1,
      review_comments_count: 0,
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      rebaseable: true,
      locked: false,
      maintainer_can_modify: true,
      auto_merge: null,
      creator: { username: 'developer-a', avatar_url: 'https://avatar/a' },
      merged_by: { username: 'developer-b', avatar_url: 'https://avatar/b' },
      merger: null,
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      milestone: null,
      reviewers: [
        {
          username: 'developer-b',
          avatar_url: 'https://avatar/b',
          state: 'APPROVED',
          submitted_at: '2026-02-24T08:00:00Z',
          commit_id: 'sha2',
        },
      ],
      checks_passed: true,
      checks: [],
      commits: [
        {
          sha: 'aaa111',
          message: 'Initial implementation',
          author: { username: 'developer-a', login: 'developer-a', avatar_url: 'https://avatar/a' },
          date: '2026-02-20T11:00:00Z',
          committer_date: '2026-02-20T11:05:00Z',
          parent_shas: [],
          html_url: 'https://github.com/commit/aaa111',
        },
      ],
      comments: [
        {
          id: 10,
          body: 'Please fix this',
          user: { username: 'developer-c', avatar_url: 'https://avatar/c' },
          created_at: '2026-02-21T09:00:00Z',
          html_url: 'https://github.com/issue-comment/10',
        },
      ],
    })

    const result = await fetchPrFromGitHub('navikt', 'nda', 18220)

    expect(result).toEqual({
      metadata: {
        number: 18220,
        title: 'Fix calculation',
        body: 'Fixes the bug',
        state: 'closed',
        merged: true,
        draft: false,
        createdAt: '2026-02-20T10:00:00Z',
        updatedAt: '2026-02-20T10:00:00Z',
        mergedAt: '2026-02-25T14:30:00Z',
        closedAt: '2026-02-25T14:30:00Z',
        baseBranch: 'main',
        baseSha: 'abc123',
        headBranch: 'feature/x',
        headSha: 'def456',
        mergeCommitSha: 'merge789',
        author: { username: 'developer-a', avatarUrl: 'https://avatar/a' },
        mergedBy: { username: 'developer-b', avatarUrl: 'https://avatar/b' },
        labels: ['bug'],
        commitsCount: 1,
        changedFiles: 5,
        additions: 120,
        deletions: 40,
        commentsCount: 1,
        reviewCommentsCount: 0,
        locked: false,
        mergeable: true,
        mergeableState: 'clean',
        rebaseable: true,
        maintainerCanModify: true,
        autoMerge: null,
        merger: null,
        assignees: [],
        requestedReviewers: [],
        requestedTeams: [],
        milestone: null,
        checksPassed: true,
      },
      reviews: [
        {
          id: 1,
          username: 'developer-b',
          state: 'APPROVED',
          submittedAt: '2026-02-24T08:00:00Z',
          body: null,
          commitId: 'sha2',
        },
      ],
      commits: [
        {
          sha: 'aaa111',
          message: 'Initial implementation',
          authorUsername: 'developer-a',
          authorLogin: 'developer-a',
          authorDate: '2026-02-20T11:00:00Z',
          committerDate: '2026-02-20T11:05:00Z',
          isMergeCommit: false,
          parentShas: [],
        },
      ],
      checks: {
        conclusion: 'success',
        checkRuns: [],
        statuses: [],
      },
      comments: [
        {
          id: 10,
          username: 'developer-c',
          body: 'Please fix this',
          createdAt: '2026-02-21T09:00:00Z',
          updatedAt: '2026-02-21T09:00:00Z',
        },
      ],
    })
  })

  it('throws when GitHub info could not be fetched', async () => {
    mockGetDetailedPrInfo.mockResolvedValue(null)

    await expect(fetchPrFromGitHub('navikt', 'nda', 1)).rejects.toThrow('Failed to fetch PR #1 from navikt/nda')
  })
})
