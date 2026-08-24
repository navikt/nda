import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import { getAllLatestPrSnapshots } from '~/db/github-data.server'

const mockPoolQuery = pool.query as Mock

describe('getAllLatestPrSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries by owner/repo/pr_number only, without filtering on schema_version', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    await getAllLatestPrSnapshots('navikt', 'nda', 100)

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.not.stringContaining('schema_version ='), ['navikt', 'nda', 100])
  })

  it('returns snapshots regardless of their stored schema_version', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 1,
          owner: 'navikt',
          repo: 'nda',
          pr_number: 100,
          data_type: 'metadata',
          schema_version: 2,
          fetched_at: new Date('2026-01-01T00:00:00Z'),
          source: 'github',
          github_available: true,
          data: { title: 'Old PR' },
        },
      ],
    })

    const result = await getAllLatestPrSnapshots('navikt', 'nda', 100)

    expect(result.get('metadata')?.data).toEqual({ title: 'Old PR' })
    expect(result.get('metadata')?.schemaVersion).toBe(2)
  })
})
