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

import { getLatestPrWindowRawSnapshot, savePrWindowRawSnapshot } from '~/db/github-data/pr-window-raw-snapshots.server'

const rawPr = { number: 42, title: 'Some PR', merged_at: '2026-01-01T00:00:00Z' }

describe('savePrWindowRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw PR response into github_pr_window_raw_snapshots', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 13 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await savePrWindowRawSnapshot('navikt', 'nda', 999, 42, rawPr, apiVersion)

    expect(id).toBe(13)
    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('github_pr_window_raw_snapshots'),
    )
    expect(insertCall?.[1]).toEqual([
      999,
      'navikt',
      'nda',
      42,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawPr),
    ])
  })

  it('acquires an advisory lock before the dedup check against the latest snapshot for the pr number', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 13 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    await savePrWindowRawSnapshot('navikt', 'nda', 999, 42, rawPr, apiVersion)

    const calls = mockClientQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls[1][0]).toContain('pg_advisory_xact_lock')
    expect(calls[1][1]).toEqual([expect.any(Number), '999:42'])
    const [query] = calls[2]
    expect(query).toContain('last_snapshot')
    expect(query).toContain('NOT EXISTS')
    expect(calls[3]).toEqual(['COMMIT'])
  })
})

describe('getLatestPrWindowRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists for the PR', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestPrWindowRawSnapshot('navikt', 'nda', 42)

    expect(result).toBeNull()
  })

  it('returns the latest raw snapshot for the given PR', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 13,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          pr_number: 42,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: rawPr,
        },
      ],
    })

    const result = await getLatestPrWindowRawSnapshot('navikt', 'nda', 42)

    expect(result).toEqual({
      id: 13,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      prNumber: 42,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: rawPr,
    })
  })
})
