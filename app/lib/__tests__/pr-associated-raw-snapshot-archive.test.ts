import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockListPullRequestsAssociatedWithCommit = vi.fn()
const mockPaginate = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    paginate: mockPaginate,
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
    mockPaginate.mockReset()
    mockPaginate.mockImplementation(async (endpoint, params, mapResponse) => {
      const results = []
      for (let page = 1; ; page++) {
        const response = await endpoint({ ...params, page })
        results.push(...mapResponse(response))
        if (response.data.length < 100) return results
      }
    })
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
      true,
    ])
  })

  it('fetches and archives PR associations from every page', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      title: `PR ${index + 1}`,
      state: 'open',
      merged_at: null,
      base: { ref: 'main' },
    }))
    const laterPagePr = { number: 101, title: 'Later PR', state: 'open', merged_at: null, base: { ref: 'main' } }
    mockListPullRequestsAssociatedWithCommit
      .mockResolvedValueOnce({ data: firstPage, headers: { 'x-github-api-version-selected': '2022-11-28' } })
      .mockResolvedValueOnce({ data: [laterPagePr], headers: { 'x-github-api-version-selected': '2022-11-28' } })

    await getPullRequestForCommit('navikt', 'pr-associated-archive-repo', 'abc123')

    expect(mockPaginate).toHaveBeenCalledWith(
      mockListPullRequestsAssociatedWithCommit,
      {
        owner: 'navikt',
        repo: 'pr-associated-archive-repo',
        commit_sha: 'abc123',
        per_page: 100,
      },
      expect.any(Function),
    )
    expect(mockListPullRequestsAssociatedWithCommit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: 1, per_page: 100 }),
    )
    expect(mockListPullRequestsAssociatedWithCommit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 2, per_page: 100 }),
    )
    expect(mockPoolQuery.mock.calls[0][1][7]).toBe(JSON.stringify([...firstPage, laterPagePr]))
    expect(mockPoolQuery.mock.calls[0][1][8]).toBe(true)
  })

  it('does not archive a snapshot when a later page cannot be fetched', async () => {
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, index) => ({
        number: index + 1,
        title: `PR ${index + 1}`,
        state: 'open',
        merged_at: null,
        base: { ref: 'main' },
      })),
      headers: {},
    })
    mockListPullRequestsAssociatedWithCommit.mockRejectedValueOnce(new Error('GitHub unavailable'))

    const result = await getPullRequestForCommit('navikt', 'pr-associated-archive-repo', 'abc123')

    expect(result).toEqual({ pr: null, allAssociatedPrs: [] })
    expect(mockPoolQuery).not.toHaveBeenCalled()
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
