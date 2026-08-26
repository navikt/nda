import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockPullsGet = vi.fn()
const mockSearchIssuesAndPullRequests = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
    },
    pulls: {
      get: mockPullsGet,
    },
    search: {
      issuesAndPullRequests: mockSearchIssuesAndPullRequests,
    },
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
import { getMergedPullRequestsInWindow } from '~/lib/github/pr/merged-window.server'

const mockPoolQuery = pool.query as Mock

describe('getMergedPullRequestsInWindow', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockPullsGet.mockReset()
    mockSearchIssuesAndPullRequests.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw PR response for each candidate PR in the window', async () => {
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
    mockSearchIssuesAndPullRequests
      .mockResolvedValueOnce({ data: { items: [{ number: 42, pull_request: {} }] } })
      .mockResolvedValueOnce({ data: { items: [] } })
    mockPullsGet.mockResolvedValueOnce({
      data: {
        number: 42,
        title: 'Some PR',
        html_url: 'https://github.com/navikt/nda/pull/42',
        merged_at: '2026-01-02T00:00:00Z',
        base: { ref: 'main' },
        head: { sha: 'headsha' },
        merge_commit_sha: 'mergedsha',
        user: { login: 'author' },
        merged_by: { login: 'merger' },
      },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await getMergedPullRequestsInWindow(
      'navikt',
      'merged-window-archive-repo',
      'main',
      '2026-01-01T00:00:00Z',
      '2026-01-03T00:00:00Z',
    )

    expect(result).toHaveLength(1)
    expect(result[0].number).toBe(42)

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('github_pr_window_raw_snapshots'),
      expect.arrayContaining([999, 'navikt', 'merged-window-archive-repo', 42, '2022-11-28']),
    )
  })
})
