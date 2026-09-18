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
import { getSingleCommitMessage, haveSameCommitTree, isCommitOnBranch } from '~/lib/github/git.server'

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

  it('returns the branch membership result without writing to github_commit_on_branch_raw_snapshots', async () => {
    mockCompareCommits.mockResolvedValueOnce({
      data: { status: 'ahead' },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await isCommitOnBranch('navikt', 'no-archive-repo', 'abc123', 'main')

    expect(result).toBe(true)
    expect(mockReposGet).not.toHaveBeenCalled()
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns false when the commit is not on the branch, still without archiving', async () => {
    mockCompareCommits.mockResolvedValueOnce({ data: { status: 'behind' }, headers: {} })

    const result = await isCommitOnBranch('navikt', 'no-archive-behind-repo', 'abc123', 'main')

    expect(result).toBe(false)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns null if the GitHub compareCommits call fails', async () => {
    mockCompareCommits.mockRejectedValueOnce(new Error('GitHub down'))

    const result = await isCommitOnBranch('navikt', 'github-failure-branch-repo', 'abc123', 'main')

    expect(result).toBeNull()
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })
})

describe('getSingleCommitMessage', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockGetCommit.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw commit response after fetching the commit message', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockGetCommit.mockResolvedValueOnce({
      data: { commit: { message: 'fix: something' } },
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await getSingleCommitMessage('navikt', 'commit-message-archive-repo', 'abc123')

    expect(result).toBe('fix: something')

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_raw_snapshots'), [
      999,
      'navikt',
      'commit-message-archive-repo',
      'abc123',
      '2022-11-28',
      null,
      null,
      JSON.stringify({ commit: { message: 'fix: something' } }),
    ])
  })

  it('still returns the commit message even if archiving fails', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockGetCommit.mockResolvedValueOnce({ data: { commit: { message: 'fix: something' } }, headers: {} })
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const result = await getSingleCommitMessage('navikt', 'db-failure-repo', 'abc123')

    expect(result).toBe('fix: something')
  })
})
