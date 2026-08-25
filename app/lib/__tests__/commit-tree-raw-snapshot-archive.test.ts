import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockGetCommit = vi.fn()
const mockCompareCommits = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
      getCommit: mockGetCommit,
      compareCommits: mockCompareCommits,
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
import { haveSameCommitTree, isCommitOnBranch } from '~/lib/github/git.server'

const mockPoolQuery = pool.query as Mock

describe('haveSameCommitTree', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockGetCommit.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives both raw commit responses after comparing trees', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockGetCommit
      .mockResolvedValueOnce({
        data: { sha: 'base123', commit: { tree: { sha: 'tree1' } } },
        headers: { 'x-github-api-version-selected': '2022-11-28' },
      })
      .mockResolvedValueOnce({
        data: { sha: 'head123', commit: { tree: { sha: 'tree1' } } },
        headers: { 'x-github-api-version-selected': '2022-11-28' },
      })

    const result = await haveSameCommitTree('navikt', 'tree-archive-repo', 'base123', 'head123')

    expect(result).toBe(true)

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_raw_snapshots'), [
      999,
      'navikt',
      'tree-archive-repo',
      'base123',
      '2022-11-28',
      null,
      null,
      JSON.stringify({ sha: 'base123', commit: { tree: { sha: 'tree1' } } }),
    ])
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_raw_snapshots'), [
      999,
      'navikt',
      'tree-archive-repo',
      'head123',
      '2022-11-28',
      null,
      null,
      JSON.stringify({ sha: 'head123', commit: { tree: { sha: 'tree1' } } }),
    ])
  })

  it('still returns the comparison result even if archiving fails', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockGetCommit
      .mockResolvedValueOnce({ data: { sha: 'base123', commit: { tree: { sha: 'tree1' } } }, headers: {} })
      .mockResolvedValueOnce({ data: { sha: 'head123', commit: { tree: { sha: 'tree2' } } }, headers: {} })
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const result = await haveSameCommitTree('navikt', 'db-failure-repo', 'base123', 'head123')

    expect(result).toBe(false)
  })
})

describe('isCommitOnBranch', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockCompareCommits.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw compareCommits response after checking branch membership', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockCompareCommits.mockResolvedValueOnce({
      data: { status: 'ahead' },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await isCommitOnBranch('navikt', 'branch-archive-repo', 'abc123', 'main')

    expect(result).toBe(true)

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_on_branch_raw_snapshots'), [
      999,
      'navikt',
      'branch-archive-repo',
      'abc123',
      'main',
      '2022-11-28',
      null,
      null,
      JSON.stringify({ status: 'ahead' }),
    ])
  })

  it('still returns the branch membership result even if archiving fails', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockCompareCommits.mockResolvedValueOnce({ data: { status: 'identical' }, headers: {} })
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const result = await isCommitOnBranch('navikt', 'db-failure-branch-repo', 'abc123', 'main')

    expect(result).toBe(true)
  })
})
