import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockPullsListReviews = vi.fn()
const mockPaginate = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
    },
    pulls: {
      listReviews: mockPullsListReviews,
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

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import { getPullRequestReviews } from '~/lib/github/pr/four-eyes-legacy.server'

const mockPoolQuery = pool.query as Mock

describe('getPullRequestReviews', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockPullsListReviews.mockReset()
    mockPaginate.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
  })

  it('archives the raw reviews response after fetching', async () => {
    const rawReviews = [
      { id: 1, user: { login: 'reviewer-a' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' },
    ]
    mockPaginate.mockImplementation((_fn: unknown, _options: unknown, mapFn?: (response: unknown) => unknown) =>
      Promise.resolve(
        mapFn ? mapFn({ headers: { 'x-github-api-version-selected': '2022-11-28' }, data: rawReviews }) : rawReviews,
      ),
    )

    const result = await getPullRequestReviews('navikt', 'legacy-review-archive-repo', 42)

    expect(result).toEqual(rawReviews)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_pr_raw_snapshots'), [
      999,
      'navikt',
      'legacy-review-archive-repo',
      42,
      'reviews',
      '2022-11-28',
      null,
      null,
      JSON.stringify(rawReviews),
    ])
  })

  it('still returns reviews even if archiving fails', async () => {
    const rawReviews = [{ id: 1, user: { login: 'reviewer-a' }, state: 'APPROVED', submitted_at: null }]
    mockPaginate.mockImplementation((_fn: unknown, _options: unknown, mapFn?: (response: unknown) => unknown) =>
      Promise.resolve(mapFn ? mapFn({ headers: {}, data: rawReviews }) : rawReviews),
    )
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const result = await getPullRequestReviews('navikt', 'db-failure-repo', 42)

    expect(result).toEqual(rawReviews)
  })
})
