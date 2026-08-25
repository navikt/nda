import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCompareCommits = vi.fn()
const mockReposGet = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      compareCommits: mockCompareCommits,
      get: mockReposGet,
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

import { getCommitsBetween } from '~/lib/github/git.server'

describe('getCommitsBetween', () => {
  beforeEach(() => {
    mockCompareCommits.mockReset()
    mockReposGet.mockReset()
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
  })

  it('maps the compare response into CompareData', async () => {
    mockCompareCommits.mockResolvedValue({
      headers: {
        'x-github-api-version-selected': '2022-11-28',
      },
      data: {
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        files: [{ filename: 'app/foo.ts' }, { filename: 'app/bar.ts' }],
        commits: [
          {
            sha: 'aaa111',
            html_url: 'https://github.com/commit/aaa111',
            author: { login: 'developer-a' },
            parents: [{ sha: 'parent1' }],
            commit: {
              message: 'Fix bug',
              author: { name: 'Developer A', date: '2026-02-20T11:00:00Z' },
              committer: { date: '2026-02-20T11:05:00Z' },
            },
          },
          {
            sha: 'bbb222',
            html_url: 'https://github.com/commit/bbb222',
            author: null,
            parents: [{ sha: 'parent1' }, { sha: 'parent2' }],
            commit: {
              message: 'Merge branch',
              author: { name: 'Developer B', date: '2026-02-20T12:00:00Z' },
              committer: null,
            },
          },
        ],
      },
    })

    const result = await getCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result?.compareData).toEqual({
      compare: {
        status: 'ahead',
        aheadBy: 2,
        behindBy: 0,
        totalCommits: 2,
        changedFiles: 2,
        noDiffDetected: false,
      },
      commits: [
        {
          sha: 'aaa111',
          message: 'Fix bug',
          authorUsername: 'developer-a',
          authorDate: '2026-02-20T11:00:00Z',
          committerDate: '2026-02-20T11:05:00Z',
          htmlUrl: 'https://github.com/commit/aaa111',
          isMergeCommit: false,
          parentShas: ['parent1'],
        },
        {
          sha: 'bbb222',
          message: 'Merge branch',
          authorUsername: 'Developer B',
          authorDate: '2026-02-20T12:00:00Z',
          committerDate: '2026-02-20T12:00:00Z',
          htmlUrl: 'https://github.com/commit/bbb222',
          isMergeCommit: true,
          parentShas: ['parent1', 'parent2'],
        },
      ],
    })
    expect(result?.rawData).toMatchObject({ status: 'ahead', total_commits: 2 })
    expect(result?.apiVersion).toEqual({
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
    })
    expect(result?.githubRepoId).toBe(999)
  })

  it('returns null when GitHub responds with an error', async () => {
    mockCompareCommits.mockRejectedValueOnce(new Error('boom'))

    const result = await getCommitsBetween('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result).toBeNull()
  })
})
