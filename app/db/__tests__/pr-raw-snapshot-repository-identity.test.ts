import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import { getAllLatestPrRawSnapshotsByRepositoryId } from '~/db/github-data.server'

const mockPoolQuery = pool.query as Mock

describe('getAllLatestPrRawSnapshotsByRepositoryId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries snapshots by immutable repository ID and PR number', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    await getAllLatestPrRawSnapshotsByRepositoryId('67890', 82)

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE github_repo_id = $1 AND pr_number = $2'),
      ['67890', 82],
    )
  })

  it('returns the latest snapshot of each data type', async () => {
    const fetchedAt = new Date('2026-10-14T10:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 5,
          owner: 'old-owner',
          repo: 'old-name',
          github_repo_id: '67890',
          pr_number: 82,
          data_type: 'pr',
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: { title: 'PR 82' },
        },
      ],
    })

    const snapshots = await getAllLatestPrRawSnapshotsByRepositoryId(67890, 82)

    expect(snapshots.get('pr')).toMatchObject({
      owner: 'old-owner',
      repo: 'old-name',
      githubRepoId: 67890,
      prNumber: 82,
      data: { title: 'PR 82' },
    })
  })
})
