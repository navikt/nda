import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import {
  getDerivedCompareDataFromRawSnapshot,
  getLatestCompareRawSnapshot,
  saveCompareRawSnapshot,
} from '~/db/github-data.server'

const mockPoolQuery = pool.query as Mock

describe('saveCompareRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw compare response into github_compare_raw_snapshots', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const rawData = { status: 'ahead', total_commits: 2, commits: [], files: [] }
    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCompareRawSnapshot('navikt', 'nda', 999, 'base-sha', 'head-sha', rawData, apiVersion)

    expect(id).toBe(7)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_compare_raw_snapshots'), [
      999,
      'navikt',
      'nda',
      'base-sha',
      'head-sha',
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawData),
    ])
  })
})

describe('getLatestCompareRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestCompareRawSnapshot('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result).toBeNull()
  })

  it('returns the latest raw snapshot for the given shas', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          base_sha: 'base-sha',
          head_sha: 'head-sha',
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: { status: 'ahead' },
        },
      ],
    })

    const result = await getLatestCompareRawSnapshot('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result).toEqual({
      id: 3,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      baseSha: 'base-sha',
      headSha: 'head-sha',
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: { status: 'ahead' },
    })
  })
})

describe('getDerivedCompareDataFromRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getDerivedCompareDataFromRawSnapshot('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result).toBeNull()
  })

  it('maps the stored raw response into CompareData', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          base_sha: 'base-sha',
          head_sha: 'head-sha',
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: new Date('2026-01-01T00:00:00Z'),
          data: { status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, files: [], commits: [] },
        },
      ],
    })

    const result = await getDerivedCompareDataFromRawSnapshot('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result?.compare.status).toBe('ahead')
  })

  it('returns null instead of throwing when the stored raw response is malformed', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          base_sha: 'base-sha',
          head_sha: 'head-sha',
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: new Date('2026-01-01T00:00:00Z'),
          data: { commits: [{ sha: 'aaa', commit: null }] },
        },
      ],
    })

    const result = await getDerivedCompareDataFromRawSnapshot('navikt', 'nda', 'base-sha', 'head-sha')

    expect(result).toBeNull()
  })
})
