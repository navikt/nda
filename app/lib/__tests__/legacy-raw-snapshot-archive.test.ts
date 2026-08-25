import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockGetCommit = vi.fn()
const mockPullsGet = vi.fn()
const mockListPullRequestsAssociatedWithCommit = vi.fn()
const mockListReviews = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
      getCommit: mockGetCommit,
      listPullRequestsAssociatedWithCommit: mockListPullRequestsAssociatedWithCommit,
    },
    pulls: {
      get: mockPullsGet,
      listReviews: mockListReviews,
    },
    paginate: (fn: unknown, params: unknown) =>
      (fn as (p: unknown) => Promise<{ data: unknown[] }>)(params).then((r) => r.data),
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
import { lookupLegacyByCommit, lookupLegacyByPR } from '~/lib/github/legacy.server'

const mockPoolQuery = pool.query as Mock

describe('lookupLegacyByCommit', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockGetCommit.mockReset()
    mockListPullRequestsAssociatedWithCommit.mockReset()
    mockListReviews.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw commit response used for the legacy lookup', async () => {
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
    mockGetCommit.mockResolvedValueOnce({
      data: {
        commit: { author: { date: '2026-01-01T00:00:00Z', name: 'Some Author' }, message: 'fix: something' },
        author: { login: 'someuser' },
      },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({ data: [], headers: {} })

    const result = await lookupLegacyByCommit(
      'navikt',
      'legacy-commit-archive-repo',
      'abc123',
      new Date('2026-01-01T00:00:00Z'),
    )

    expect(result.success).toBe(true)

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('github_commit_raw_snapshots'),
      expect.arrayContaining([999, 'navikt', 'legacy-commit-archive-repo', 'abc123', '2022-11-28']),
    )
  })
})

describe('lookupLegacyByPR', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockPullsGet.mockReset()
    mockListReviews.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw PR response used for the legacy lookup', async () => {
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
    mockPullsGet.mockResolvedValueOnce({
      data: {
        number: 42,
        title: 'Some PR',
        html_url: 'https://github.com/navikt/nda/pull/42',
        merged_at: '2026-01-01T00:00:00Z',
        merge_commit_sha: 'mergedsha',
        merged_by: { login: 'merger' },
        user: { login: 'author' },
      },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })
    mockListReviews.mockResolvedValueOnce({ data: [] })

    const result = await lookupLegacyByPR('navikt', 'legacy-pr-archive-repo', 42, new Date('2026-01-01T00:00:00Z'))

    expect(result.success).toBe(true)

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('github_pr_window_raw_snapshots'),
      expect.arrayContaining([999, 'navikt', 'legacy-pr-archive-repo', 42, '2022-11-28']),
    )
  })
})
