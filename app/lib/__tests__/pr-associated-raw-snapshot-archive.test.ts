import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockListPullRequestsAssociatedWithCommit = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
      listPullRequestsAssociatedWithCommit: mockListPullRequestsAssociatedWithCommit,
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
import { getPullRequestForCommit } from '~/lib/github/pr.server'

const mockPoolQuery = pool.query as Mock

describe('getPullRequestForCommit', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockListPullRequestsAssociatedWithCommit.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw associated-PRs response after a lookup', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    const rawPrs = [{ number: 42, title: 'Some PR', state: 'open', merged_at: null, base: { ref: 'main' } }]
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({
      data: rawPrs,
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await getPullRequestForCommit('navikt', 'pr-associated-archive-repo', 'abc123')

    expect(result.pr?.number).toBe(42)

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_associated_prs_raw_snapshots'), [
      999,
      'navikt',
      'pr-associated-archive-repo',
      'abc123',
      '2022-11-28',
      null,
      null,
      JSON.stringify(rawPrs),
    ])
  })

  it('still returns the PR lookup result even if archiving fails', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    const rawPrs = [{ number: 42, title: 'Some PR', state: 'open', merged_at: null, base: { ref: 'main' } }]
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({ data: rawPrs, headers: {} })
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const result = await getPullRequestForCommit('navikt', 'db-failure-repo', 'abc123')

    expect(result.pr?.number).toBe(42)
  })
})
