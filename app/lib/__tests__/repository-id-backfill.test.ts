import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery, mockLoggerWarn } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLoggerWarn: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/sync-jobs.server', () => ({
  getSyncJobById: vi.fn(),
  isSyncJobCancelled: vi.fn(),
  releaseSyncLock: vi.fn(),
}))

vi.mock('~/db/workflow-run-repository-backfill-coverage.server', () => ({
  backfillEligibleWorkflowRunRepositoryIds: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: mockLoggerWarn },
  runWithJobContext: vi.fn((_jobId, _jobType, _target, _debug, callback) => callback()),
}))

import { queueRepositoryIdBackfill } from '~/lib/repository-id-backfill.server'

describe('queueRepositoryIdBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a repository-scoped job after releasing an expired job lock', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 80 }] })
      .mockResolvedValueOnce({ rows: [{ id: 91 }] })

    await expect(queueRepositoryIdBackfill(216, 'Z990001')).resolves.toEqual({ jobId: 91, started: true })
    expect(mockPoolQuery).toHaveBeenCalledTimes(2)
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual([216])
    expect(mockLoggerWarn).toHaveBeenCalledOnce()
    expect(mockPoolQuery.mock.calls[1]?.[1]).toEqual([
      216,
      expect.any(String),
      JSON.stringify({ updated: 0 }),
      JSON.stringify({ initiatedBy: 'Z990001' }),
    ])
  })

  it('returns the existing running job instead of queuing a duplicate', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 92 }] })

    await expect(queueRepositoryIdBackfill(216, 'Z990001')).resolves.toEqual({ jobId: 92, started: false })
    expect(mockPoolQuery).toHaveBeenCalledTimes(3)
  })

  it('returns null if an insert conflict has no active job to attach to', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(queueRepositoryIdBackfill(216, 'Z990001')).resolves.toBeNull()
  })
})
