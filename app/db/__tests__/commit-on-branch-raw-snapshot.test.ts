import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import {
  getDerivedCommitOnBranchStatusFromRawSnapshot,
  getLatestCommitOnBranchRawSnapshot,
  saveCommitOnBranchRawSnapshot,
} from '~/db/github-data/commit-on-branch-raw-snapshots.server'

const mockPoolQuery = pool.query as Mock

const rawCompare = { status: 'ahead', ahead_by: 2, behind_by: 0 }

describe('saveCommitOnBranchRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw compareCommits response into github_commit_on_branch_raw_snapshots', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCommitOnBranchRawSnapshot('navikt', 'nda', 999, 'abc123', 'main', rawCompare, apiVersion)

    expect(id).toBe(7)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_commit_on_branch_raw_snapshots'), [
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

describe('getDerivedCommitOnBranchStatusFromRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getDerivedCommitOnBranchStatusFromRawSnapshot('navikt', 'nda', 999, 'abc123', 'main')

    expect(result).toBeNull()
  })

  it('returns true when the latest snapshot status is identical and the repo id matches', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7, github_repo_id: 999, data: { status: 'identical' } }] })

    const result = await getDerivedCommitOnBranchStatusFromRawSnapshot('navikt', 'nda', 999, 'abc123', 'main')

    expect(result).toBe(true)
  })

  it('returns true when the latest snapshot status is ahead and the repo id matches', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7, github_repo_id: 999, data: { status: 'ahead' } }] })

    const result = await getDerivedCommitOnBranchStatusFromRawSnapshot('navikt', 'nda', 999, 'abc123', 'main')

    expect(result).toBe(true)
  })

  it('returns null when the latest snapshot status is behind (not cached as definitive)', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7, github_repo_id: 999, data: { status: 'behind' } }] })

    const result = await getDerivedCommitOnBranchStatusFromRawSnapshot('navikt', 'nda', 999, 'abc123', 'main')

    expect(result).toBeNull()
  })

  it('returns null when the cached snapshot belongs to a different (e.g. deleted/recreated) repository id', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7, github_repo_id: 111, data: { status: 'identical' } }] })

    const result = await getDerivedCommitOnBranchStatusFromRawSnapshot('navikt', 'nda', 999, 'abc123', 'main')

    expect(result).toBeNull()
  })
})
