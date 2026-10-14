import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockPoolQuery } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockPoolQuery: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/github-data.server', () => ({
  cleanupOldSnapshots: vi.fn(),
}))

import { loader } from './snapshot-cleanup'

describe('snapshot cleanup loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue(undefined)
    mockPoolQuery.mockResolvedValue({ rows: [] })
  })

  it('includes workflow job snapshots in the table size query', async () => {
    await loader({ request: new Request('http://localhost/admin/snapshot-cleanup') } as never)

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.any(String), [
      expect.arrayContaining(['github_workflow_jobs_raw_snapshots']),
    ])
  })
})
