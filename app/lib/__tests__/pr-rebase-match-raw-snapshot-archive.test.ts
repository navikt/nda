import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockListPullRequestsAssociatedWithCommit = vi.fn()
const mockPaginate = vi.fn()
const mockPullsListCommits = vi.fn()
const mockReposGetCommit = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    paginate: mockPaginate,
    repos: {
      get: mockReposGet,
      listPullRequestsAssociatedWithCommit: mockListPullRequestsAssociatedWithCommit,
      getCommit: mockReposGetCommit,
    },
    pulls: {
      listCommits: mockPullsListCommits,
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

describe('getPullRequestForCommit rebase-matching archival', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockListPullRequestsAssociatedWithCommit.mockReset()
    mockPaginate.mockReset()
    mockPaginate.mockImplementation(async (endpoint, params, mapResponse) =>
      mapResponse(await endpoint({ ...params, page: 1 })),
    )
    mockPullsListCommits.mockReset()
    mockReposGetCommit.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
  })

  it.each([
    ['membership', false],
    ['membership', true],
    ['rebase', false],
    ['rebase', true],
  ] as const)('handles %s lookup failures according to strict mode (%s)', async (stage, strict) => {
    const error = new Error('GitHub unavailable')
    const repo = `lookup-${stage}-${strict}`
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({
      data: [
        { number: 42, title: 'Some PR', state: 'closed', merged_at: '2026-01-01T00:00:00Z', base: { ref: 'main' } },
      ],
      headers: {},
    })
    if (stage === 'membership') {
      mockPullsListCommits.mockRejectedValueOnce(error)
    } else {
      mockPullsListCommits.mockResolvedValueOnce({
        data: [
          {
            sha: 'original-sha',
            commit: { author: { name: 'Glad Fjord', date: '2026-01-01T00:00:00Z' }, message: 'Feature' },
          },
        ],
        headers: {},
      })
      mockReposGetCommit.mockRejectedValueOnce(error)
    }

    const result = getPullRequestForCommit('navikt', repo, 'rebased-sha', true, 'main', strict)

    if (strict) {
      await expect(result).rejects.toBe(error)
    } else {
      await expect(result).resolves.toEqual({
        pr: null,
        allAssociatedPrs: [{ number: 42, baseBranch: 'main' }],
      })
    }
  })

  it('archives PR commits and the target commit when a direct match is not found', async () => {
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({
      data: [
        { number: 42, title: 'Some PR', state: 'closed', merged_at: '2026-01-01T00:00:00Z', base: { ref: 'main' } },
      ],
      headers: {},
    })

    const prCommits = [
      {
        sha: 'orig-sha',
        commit: { author: { name: 'Author A', date: '2026-01-01T00:00:00Z' }, message: 'fix: bug' },
        author: { login: 'author-a' },
      },
    ]
    mockPullsListCommits.mockResolvedValueOnce({
      data: prCommits,
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    mockReposGetCommit.mockResolvedValueOnce({
      data: {
        commit: { author: { name: 'Author A', date: '2026-01-01T00:00:00Z' }, message: 'fix: bug' },
        author: { login: 'author-a' },
      },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await getPullRequestForCommit('navikt', 'rebase-archive-repo', 'rebased-sha', true)

    expect(result.pr?.number).toBe(42)

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_pr_raw_snapshots'), [
      999,
      'navikt',
      'rebase-archive-repo',
      42,
      'commits',
      '2022-11-28',
      null,
      null,
      JSON.stringify(prCommits),
    ])

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_raw_snapshots'), [
      999,
      'navikt',
      'rebase-archive-repo',
      'rebased-sha',
      '2022-11-28',
      null,
      null,
      expect.any(String),
    ])
  })

  it('still returns a rebase match even if archiving fails', async () => {
    mockListPullRequestsAssociatedWithCommit.mockResolvedValueOnce({
      data: [
        { number: 42, title: 'Some PR', state: 'closed', merged_at: '2026-01-01T00:00:00Z', base: { ref: 'main' } },
      ],
      headers: {},
    })

    const prCommits = [
      {
        sha: 'orig-sha',
        commit: { author: { name: 'Author A', date: '2026-01-01T00:00:00Z' }, message: 'fix: bug' },
        author: { login: 'author-a' },
      },
    ]
    mockPullsListCommits.mockResolvedValueOnce({ data: prCommits, headers: {} })
    mockReposGetCommit.mockResolvedValueOnce({
      data: {
        commit: { author: { name: 'Author A', date: '2026-01-01T00:00:00Z' }, message: 'fix: bug' },
        author: { login: 'author-a' },
      },
      headers: {},
    })
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const result = await getPullRequestForCommit('navikt', 'db-failure-repo', 'rebased-sha', true)

    expect(result.pr?.number).toBe(42)
  })
})
