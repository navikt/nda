import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPullsGet = vi.fn()
const mockPullsListReviews = vi.fn()
const mockPullsListCommits = vi.fn()
const mockIssuesListComments = vi.fn()
const mockPullsListReviewComments = vi.fn()
const mockPaginate = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    pulls: {
      get: mockPullsGet,
      listReviews: mockPullsListReviews,
      listCommits: mockPullsListCommits,
      listReviewComments: mockPullsListReviewComments,
    },
    issues: {
      listComments: mockIssuesListComments,
    },
    paginate: mockPaginate,
  }),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { getDetailedPullRequestInfo } from '~/lib/github/pr.server'

describe('getDetailedPullRequestInfo', () => {
  beforeEach(() => {
    mockPullsGet.mockReset()
    mockPullsListReviews.mockReset()
    mockPullsListCommits.mockReset()
    mockIssuesListComments.mockReset()
    mockPullsListReviewComments.mockReset()
    mockPaginate.mockReset()

    mockPullsGet.mockResolvedValue({
      headers: {},
      data: {
        title: 'Fix calculation',
        body: 'Fixes the bug',
        labels: ['bug', { name: 'priority-high' }],
        created_at: '2026-02-20T10:00:00Z',
        merged_at: '2026-02-25T14:30:00Z',
        base: { ref: 'main', sha: 'abc123', repo: { id: 999 } },
        head: { ref: 'feature/x', sha: 'def456' },
        merge_commit_sha: 'merge789',
        commits: 3,
        changed_files: 5,
        additions: 120,
        deletions: 40,
        comments: 2,
        review_comments: 1,
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        rebaseable: true,
        locked: false,
        maintainer_can_modify: true,
        auto_merge: { enabled_by: { login: 'developer-b' }, merge_method: 'squash' },
        user: { login: 'developer-a', avatar_url: 'https://avatar/a' },
        merged_by: { login: 'developer-b', avatar_url: 'https://avatar/b' },
        assignees: [{ login: 'developer-a', avatar_url: 'https://avatar/a' }],
        requested_reviewers: [{ login: 'developer-c', avatar_url: 'https://avatar/c' }],
        requested_teams: [{ name: 'Team Pensjon', slug: 'team-pensjon' }],
        milestone: { title: 'Sprint 42', number: 42, state: 'open' },
      },
    })

    mockPaginate.mockImplementation(
      (
        fn: unknown,
        _options: unknown,
        mapFn?: (response: { headers: Record<string, unknown>; data: unknown[] }) => unknown,
      ) => {
        const respond = (data: unknown[]): unknown => (mapFn ? mapFn({ headers: {}, data }) : data)

        if (fn === mockPullsListReviews) {
          return Promise.resolve(
            respond([
              {
                id: 1,
                user: { login: 'developer-b', avatar_url: 'https://avatar/b' },
                state: 'COMMENTED',
                submitted_at: '2026-02-23T08:00:00Z',
                commit_id: 'sha1',
                body: '   ',
                html_url: 'https://github.com/pr/1#review-1',
              },
              {
                id: 2,
                user: { login: 'developer-b', avatar_url: 'https://avatar/b' },
                state: 'APPROVED',
                submitted_at: '2026-02-24T08:00:00Z',
                commit_id: 'sha2',
                body: 'LGTM overall',
                html_url: 'https://github.com/pr/1#review-2',
              },
            ]),
          )
        }
        if (fn === mockPullsListCommits) {
          return Promise.resolve(
            respond([
              {
                sha: 'aaa111',
                html_url: 'https://github.com/commit/aaa111',
                author: { login: 'developer-a', avatar_url: 'https://avatar/a' },
                parents: [{ sha: 'parent1' }],
                commit: {
                  message: 'Initial implementation',
                  author: { name: 'Developer A', date: '2026-02-20T11:00:00Z' },
                  committer: { date: '2026-02-20T11:05:00Z' },
                },
              },
            ]),
          )
        }
        if (fn === mockIssuesListComments) {
          return Promise.resolve(
            respond([
              {
                id: 10,
                body: 'Please fix this',
                user: { login: 'developer-c', avatar_url: 'https://avatar/c' },
                created_at: '2026-02-21T09:00:00Z',
                html_url: 'https://github.com/issue-comment/10',
              },
            ]),
          )
        }
        if (fn === mockPullsListReviewComments) {
          return Promise.resolve(
            respond([
              {
                id: 20,
                body: 'Inline nit',
                user: { login: 'developer-b', avatar_url: 'https://avatar/b' },
                created_at: '2026-02-22T09:00:00Z',
                html_url: 'https://github.com/review-comment/20',
              },
            ]),
          )
        }
        return Promise.resolve(respond([]))
      },
    )
  })

  it('assembles the full detailed PR data shape from raw GitHub responses', async () => {
    const result = await getDetailedPullRequestInfo('navikt', 'nda', 18220)

    expect(result?.githubRepoId).toBe(999)
    expect(result?.apiVersion).toEqual({ apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null })
    expect(result?.raw.pr).toBeDefined()
    expect(result?.raw.reviews).toHaveLength(2)
    expect(result?.raw.commits).toHaveLength(1)
    expect(result?.raw.issueComments).toHaveLength(1)
    expect(result?.raw.reviewComments).toHaveLength(1)

    expect(result?.prData).toEqual({
      title: 'Fix calculation',
      body: 'Fixes the bug',
      labels: ['bug', 'priority-high'],
      created_at: '2026-02-20T10:00:00Z',
      merged_at: '2026-02-25T14:30:00Z',
      base_branch: 'main',
      base_sha: 'abc123',
      head_branch: 'feature/x',
      head_sha: 'def456',
      merge_commit_sha: 'merge789',
      commits_count: 3,
      changed_files: 5,
      additions: 120,
      deletions: 40,
      comments_count: 2,
      review_comments_count: 1,
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      rebaseable: true,
      locked: false,
      maintainer_can_modify: true,
      auto_merge: { enabled_by: 'developer-b', merge_method: 'squash' },
      creator: { username: 'developer-a', avatar_url: 'https://avatar/a' },
      merged_by: { username: 'developer-b', avatar_url: 'https://avatar/b' },
      merger: { username: 'developer-b', avatar_url: 'https://avatar/b' },
      assignees: [{ username: 'developer-a', avatar_url: 'https://avatar/a' }],
      requested_reviewers: [{ username: 'developer-c', avatar_url: 'https://avatar/c' }],
      requested_teams: [{ name: 'Team Pensjon', slug: 'team-pensjon' }],
      milestone: { title: 'Sprint 42', number: 42, state: 'open' },
      reviewers: [
        {
          username: 'developer-b',
          avatar_url: 'https://avatar/b',
          state: 'APPROVED',
          submitted_at: '2026-02-24T08:00:00Z',
          commit_id: 'sha2',
        },
      ],
      checks_passed: null,
      checks: [],
      commits: [
        {
          sha: 'aaa111',
          message: 'Initial implementation',
          author: { username: 'developer-a', login: 'developer-a', avatar_url: 'https://avatar/a' },
          date: '2026-02-20T11:00:00Z',
          committer_date: '2026-02-20T11:05:00Z',
          parent_shas: ['parent1'],
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
        {
          id: 20,
          body: 'Inline nit',
          user: { username: 'developer-b', avatar_url: 'https://avatar/b' },
          created_at: '2026-02-22T09:00:00Z',
          html_url: 'https://github.com/review-comment/20',
        },
        {
          id: 2,
          body: 'LGTM overall',
          user: { username: 'developer-b', avatar_url: 'https://avatar/b' },
          created_at: '2026-02-24T08:00:00Z',
          html_url: 'https://github.com/pr/1#review-2',
        },
      ],
    })
  })

  it('captures api version metadata from paginated response headers', async () => {
    mockPaginate.mockImplementation(
      (
        fn: unknown,
        _options: unknown,
        mapFn?: (response: { headers: Record<string, unknown>; data: unknown[] }) => unknown,
      ) => {
        if (fn === mockPullsListReviews) {
          return Promise.resolve(
            mapFn?.({
              headers: {
                'x-github-api-version-selected': '2022-11-28',
                deprecation: '2027-01-01T00:00:00Z',
                sunset: '2027-06-01T00:00:00Z',
              },
              data: [],
            }),
          )
        }
        return Promise.resolve(mapFn ? mapFn({ headers: {}, data: [] }) : [])
      },
    )

    const result = await getDetailedPullRequestInfo('navikt', 'nda', 18220)

    expect(result?.apiVersion).toEqual({
      apiVersion: '2022-11-28',
      apiDeprecatedAt: '2027-01-01T00:00:00Z',
      apiSunsetAt: '2027-06-01T00:00:00Z',
    })
  })

  it('returns null when GitHub responds with an error', async () => {
    mockPullsGet.mockRejectedValueOnce(new Error('boom'))

    const result = await getDetailedPullRequestInfo('navikt', 'nda', 1)

    expect(result).toBeNull()
  })
})
