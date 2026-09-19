import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClientQuery, mockClient, mockPoolQuery } = vi.hoisted(() => {
  const mockClientQuery = vi.fn()
  return {
    mockClientQuery,
    mockClient: { query: mockClientQuery, release: vi.fn() },
    mockPoolQuery: vi.fn(),
  }
})

vi.mock('~/db/connection.server', () => ({
  pool: { connect: vi.fn(async () => mockClient), query: mockPoolQuery },
}))

import { getLatestCommitRawSnapshot, saveCommitRawSnapshot } from '~/db/github-data/commit-raw-snapshots.server'

const rawCommit = { sha: 'abc123', commit: { tree: { sha: 'tree123' } } }

describe('saveCommitRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw commit response into github_commit_raw_snapshots', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCommitRawSnapshot('navikt', 'nda', 999, 'abc123', rawCommit, apiVersion)

    expect(id).toBe(7)
    const insertCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('github_commit_raw_snapshots'))
    expect(insertCall?.[1]).toEqual([
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

  it('acquires an advisory lock scoped to the repo/sha before the dedup check', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    await saveCommitRawSnapshot('navikt', 'nda', 999, 'abc123', rawCommit, apiVersion)

    const calls = mockClientQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls[1][0]).toContain('pg_advisory_xact_lock')
    expect(calls[1][1]).toEqual([expect.any(Number), '999:abc123'])
    const [query] = calls[2]
    expect(query).toContain('last_snapshot')
    expect(query).toContain('NOT EXISTS')
    expect(calls[3]).toEqual(['COMMIT'])
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
