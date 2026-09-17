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

import {
  getLatestCommitOnBranchRawSnapshot,
  saveCommitOnBranchRawSnapshot,
} from '~/db/github-data/commit-on-branch-raw-snapshots.server'

const rawCompare = { status: 'ahead', ahead_by: 2, behind_by: 0 }

describe('saveCommitOnBranchRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw compareCommits response into github_commit_on_branch_raw_snapshots', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCommitOnBranchRawSnapshot('navikt', 'nda', 999, 'abc123', 'main', rawCompare, apiVersion)

    expect(id).toBe(7)
    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('github_commit_on_branch_raw_snapshots'),
    )
    expect(insertCall?.[1]).toEqual([
      999,
      'navikt',
      'nda',
      'abc123',
      'main',
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawCompare),
    ])
  })

  it('acquires an advisory lock before the dedup check against the latest snapshot for the sha/branch', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    await saveCommitOnBranchRawSnapshot('navikt', 'nda', 999, 'abc123', 'main', rawCompare, apiVersion)

    const calls = mockClientQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls[1][0]).toContain('pg_advisory_xact_lock')
    expect(calls[1][1]).toEqual([expect.any(Number), '999:abc123:main'])
    const [query] = calls[2]
    expect(query).toContain('last_snapshot')
    expect(query).toContain('NOT EXISTS')
    expect(calls[3]).toEqual(['COMMIT'])
  })
})

describe('getLatestCommitOnBranchRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists for the commit/branch pair', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestCommitOnBranchRawSnapshot('navikt', 'nda', 'abc123', 'main')

    expect(result).toBeNull()
  })

  it('returns the latest raw snapshot for the given commit/branch pair', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 7,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          commit_sha: 'abc123',
          branch: 'main',
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: rawCompare,
        },
      ],
    })

    const result = await getLatestCommitOnBranchRawSnapshot('navikt', 'nda', 'abc123', 'main')

    expect(result).toEqual({
      id: 7,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      commitSha: 'abc123',
      branch: 'main',
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: rawCompare,
    })
  })
})
