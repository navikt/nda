import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSearch = vi.fn()
const mockPullGet = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    search: {
      issuesAndPullRequests: mockSearch,
    },
    pulls: {
      get: mockPullGet,
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

import { getMergedPullRequestsInWindow } from '~/lib/github/pr.server'

describe('getMergedPullRequestsInWindow', () => {
  beforeEach(() => {
    mockSearch.mockReset()
    mockPullGet.mockReset()
  })

  it('fetches PRs from search and includes merged-by from pulls.get', async () => {
    mockSearch.mockResolvedValueOnce({
      data: {
        items: [{ number: 123, pull_request: { url: 'https://api.github.com/repos/navikt/nda/pulls/123' } }],
      },
    })

    mockPullGet.mockResolvedValueOnce({
      data: {
        number: 123,
        title: 'Fix bug',
        html_url: 'https://github.com/navikt/nda/pull/123',
        merged_at: '2026-04-21T10:00:00Z',
        base: { ref: 'main' },
        head: { sha: 'headsha123' },
        merge_commit_sha: 'mergesha123',
        user: { login: 'author-a' },
        merged_by: { login: 'merger-b' },
      },
    })

    const result = await getMergedPullRequestsInWindow(
      'navikt',
      'nda',
      'main',
      '2026-04-21T09:30:00Z',
      '2026-04-21T10:30:00Z',
    )

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: expect.stringContaining('merged:2026-04-21..2026-04-21'),
      }),
    )
    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      {
        number: 123,
        title: 'Fix bug',
        htmlUrl: 'https://github.com/navikt/nda/pull/123',
        mergedAt: '2026-04-21T10:00:00Z',
        baseBranch: 'main',
        headSha: 'headsha123',
        mergeCommitSha: 'mergesha123',
        authorUsername: 'author-a',
        mergedByUsername: 'merger-b',
      },
    ])
  })

  it('filters out PRs outside the exact timestamp window after search', async () => {
    mockSearch.mockResolvedValueOnce({
      data: {
        items: [{ number: 200, pull_request: { url: 'https://api.github.com/repos/navikt/nda/pulls/200' } }],
      },
    })

    mockPullGet.mockResolvedValueOnce({
      data: {
        number: 200,
        title: 'Outside',
        html_url: 'https://github.com/navikt/nda/pull/200',
        merged_at: '2026-04-21T12:00:00Z',
        base: { ref: 'main' },
        head: { sha: 'headsha200' },
        merge_commit_sha: 'mergesha200',
        user: { login: 'author-a' },
        merged_by: { login: 'merger-b' },
      },
    })

    const result = await getMergedPullRequestsInWindow(
      'navikt',
      'nda',
      'main',
      '2026-04-21T09:30:00Z',
      '2026-04-21T10:30:00Z',
    )

    expect(result).toEqual([])
  })

  it('does not fail whole window when one pulls.get call fails', async () => {
    mockSearch.mockResolvedValueOnce({
      data: {
        items: [
          { number: 300, pull_request: { url: 'https://api.github.com/repos/navikt/nda/pulls/300' } },
          { number: 301, pull_request: { url: 'https://api.github.com/repos/navikt/nda/pulls/301' } },
        ],
      },
    })

    mockPullGet.mockRejectedValueOnce(new Error('Temporary failure'))
    mockPullGet.mockResolvedValueOnce({
      data: {
        number: 301,
        title: 'Working PR',
        html_url: 'https://github.com/navikt/nda/pull/301',
        merged_at: '2026-04-21T10:05:00Z',
        base: { ref: 'main' },
        head: { sha: 'headsha301' },
        merge_commit_sha: 'mergesha301',
        user: { login: 'author-a' },
        merged_by: { login: 'merger-b' },
      },
    })

    const result = await getMergedPullRequestsInWindow(
      'navikt',
      'nda',
      'main',
      '2026-04-21T09:30:00Z',
      '2026-04-21T10:30:00Z',
    )

    expect(result).toEqual([
      expect.objectContaining({
        number: 301,
      }),
    ])
  })

  it('stops pagination at max page guard', async () => {
    mockSearch.mockImplementation(async ({ page }: { page: number }) => ({
      data: {
        items:
          page <= 10
            ? Array.from({ length: 100 }, (_, index) => ({
                number: page * 1000 + index,
                pull_request: { url: 'https://api.github.com/repos/navikt/nda/pulls/x' },
              }))
            : [],
      },
    }))

    mockPullGet.mockResolvedValue({
      data: {
        number: 999,
        title: 'Ignored in assertion',
        html_url: 'https://github.com/navikt/nda/pull/999',
        merged_at: '2026-04-21T10:00:00Z',
        base: { ref: 'main' },
        head: { sha: 'headsha999' },
        merge_commit_sha: 'mergesha999',
        user: { login: 'author-a' },
        merged_by: { login: 'merger-b' },
      },
    })

    await getMergedPullRequestsInWindow('navikt', 'nda', 'main', '2026-04-21T09:30:00Z', '2026-04-21T10:30:00Z')

    expect(mockSearch).toHaveBeenCalledTimes(10)
  })
})
