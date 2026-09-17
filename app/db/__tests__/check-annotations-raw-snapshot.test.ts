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
  getLatestCheckAnnotationsRawSnapshot,
  saveCheckAnnotationsRawSnapshot,
} from '~/db/github-data/check-annotations-raw-snapshots.server'

const rawAnnotations = [{ path: 'src/foo.ts', message: 'some issue', annotation_level: 'warning' }]

describe('saveCheckAnnotationsRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw annotations response into github_check_annotations_raw_snapshots', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCheckAnnotationsRawSnapshot('navikt', 'nda', 999, 555, rawAnnotations, apiVersion)

    expect(id).toBe(7)
    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('github_check_annotations_raw_snapshots'),
    )
    expect(insertCall?.[1]).toEqual([
      999,
      'navikt',
      'nda',
      555,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawAnnotations),
    ])
  })

  it('acquires an advisory lock before the dedup check against the latest snapshot for the check run', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    await saveCheckAnnotationsRawSnapshot('navikt', 'nda', 999, 555, rawAnnotations, apiVersion)

    const calls = mockClientQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls[1][0]).toContain('pg_advisory_xact_lock')
    expect(calls[1][1]).toEqual([expect.any(Number), '999:555'])
    const [query] = calls[2]
    expect(query).toContain('last_snapshot')
    expect(query).toContain('NOT EXISTS')
    expect(calls[3]).toEqual(['COMMIT'])
  })
})

describe('getLatestCheckAnnotationsRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists for the check run', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestCheckAnnotationsRawSnapshot('navikt', 'nda', 555)

    expect(result).toBeNull()
  })

  it('returns the latest raw snapshot for the given check run', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 7,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          check_run_id: 555,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: rawAnnotations,
        },
      ],
    })

    const result = await getLatestCheckAnnotationsRawSnapshot('navikt', 'nda', 555)

    expect(result).toEqual({
      id: 7,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      checkRunId: 555,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: rawAnnotations,
    })
  })
})
