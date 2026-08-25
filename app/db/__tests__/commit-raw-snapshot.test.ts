import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import { getLatestCommitRawSnapshot, saveCommitRawSnapshot } from '~/db/github-data/commit-raw-snapshots.server'

const mockPoolQuery = pool.query as Mock

const rawCommit = { sha: 'abc123', commit: { tree: { sha: 'tree123' } } }

describe('saveCommitRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw commit response into github_commit_raw_snapshots', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCommitRawSnapshot('navikt', 'nda', 999, 'abc123', rawCommit, apiVersion)

    expect(id).toBe(7)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_raw_snapshots'), [
      999,
      'navikt',
      'nda',
      'abc123',
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawCommit),
    ])
  })
})

describe('getLatestCommitRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists for the sha', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestCommitRawSnapshot('navikt', 'nda', 'abc123')

    expect(result).toBeNull()
  })

  it('returns the latest raw snapshot for the given sha', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 7,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          sha: 'abc123',
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: rawCommit,
        },
      ],
    })

    const result = await getLatestCommitRawSnapshot('navikt', 'nda', 'abc123')

    expect(result).toEqual({
      id: 7,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      sha: 'abc123',
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: rawCommit,
    })
  })
})
