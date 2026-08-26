import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import {
  getLatestCheckAnnotationsRawSnapshot,
  saveCheckAnnotationsRawSnapshot,
} from '~/db/github-data/check-annotations-raw-snapshots.server'

const mockPoolQuery = pool.query as Mock

const rawAnnotations = [{ path: 'src/foo.ts', message: 'some issue', annotation_level: 'warning' }]

describe('saveCheckAnnotationsRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw annotations response into github_check_annotations_raw_snapshots', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveCheckAnnotationsRawSnapshot('navikt', 'nda', 999, 555, rawAnnotations, apiVersion)

    expect(id).toBe(7)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_check_annotations_raw_snapshots'), [
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
