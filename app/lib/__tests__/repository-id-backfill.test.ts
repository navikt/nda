import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPoolQuery,
  mockLoggerWarn,
  mockBackfillEligibleWorkflowRunRepositoryIds,
  mockGetSyncJobById,
  mockHeartbeatRepositoryIdBackfillJob,
  mockIsSyncJobCancelled,
  mockReleaseSyncLock,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockBackfillEligibleWorkflowRunRepositoryIds: vi.fn(),
  mockGetSyncJobById: vi.fn(),
  mockHeartbeatRepositoryIdBackfillJob: vi.fn(),
  mockIsSyncJobCancelled: vi.fn(),
  mockReleaseSyncLock: vi.fn(),
  mockLoggerError: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/sync-jobs.server', () => ({
  getSyncJobById: mockGetSyncJobById,
  heartbeatRepositoryIdBackfillJob: mockHeartbeatRepositoryIdBackfillJob,
  isSyncJobCancelled: mockIsSyncJobCancelled,
  releaseSyncLock: mockReleaseSyncLock,
}))

vi.mock('~/db/workflow-run-repository-backfill-coverage.server', () => ({
  backfillEligibleWorkflowRunRepositoryIds: mockBackfillEligibleWorkflowRunRepositoryIds,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: mockLoggerError, info: vi.fn(), warn: mockLoggerWarn },
  runWithJobContext: vi.fn((_jobId, _jobType, _target, _debug, callback) => callback()),
}))

import { processRepositoryIdBackfillJobAsync, queueRepositoryIdBackfill } from '~/lib/repository-id-backfill.server'

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

describe('processRepositoryIdBackfillJobAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSyncJobCancelled.mockResolvedValue(false)
  })

  it('backfills eligible deployments and completes a still-running job', async () => {
    mockBackfillEligibleWorkflowRunRepositoryIds.mockResolvedValue(3)
    mockGetSyncJobById.mockResolvedValue({ status: 'running' })
    mockReleaseSyncLock.mockResolvedValue(true)

    await processRepositoryIdBackfillJobAsync(91, 216)

    expect(mockBackfillEligibleWorkflowRunRepositoryIds).toHaveBeenCalledWith(216)
    expect(mockGetSyncJobById).toHaveBeenCalledWith(91)
    expect(mockReleaseSyncLock).toHaveBeenCalledWith(91, 'completed', { updated: 3, repositoryId: 216 })
  })

  it('renews the lease while a repository backfill is still running', async () => {
    vi.useFakeTimers()
    mockBackfillEligibleWorkflowRunRepositoryIds.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(3), 6 * 60 * 1000)
        }),
    )
    mockGetSyncJobById.mockResolvedValue({ status: 'running' })
    mockReleaseSyncLock.mockResolvedValue(true)
    mockHeartbeatRepositoryIdBackfillJob.mockResolvedValue(true)

    try {
      const processing = processRepositoryIdBackfillJobAsync(91, 216)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(mockHeartbeatRepositoryIdBackfillJob).toHaveBeenCalledWith(91, 30)

      await vi.advanceTimersByTimeAsync(60 * 1000)
      await processing

      expect(mockReleaseSyncLock).toHaveBeenCalledWith(91, 'completed', { updated: 3, repositoryId: 216 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks a still-running job failed and rethrows when backfill fails', async () => {
    const error = new Error('Database unavailable')
    mockBackfillEligibleWorkflowRunRepositoryIds.mockRejectedValue(error)
    mockGetSyncJobById.mockResolvedValue({ status: 'running' })

    await expect(processRepositoryIdBackfillJobAsync(91, 216)).rejects.toBe(error)

    expect(mockReleaseSyncLock).toHaveBeenCalledWith(91, 'failed', undefined, 'Database unavailable')
  })

  it('does not process or release a job that was cancelled before the worker started', async () => {
    mockIsSyncJobCancelled.mockResolvedValue(true)

    await processRepositoryIdBackfillJobAsync(91, 216)

    expect(mockBackfillEligibleWorkflowRunRepositoryIds).not.toHaveBeenCalled()
    expect(mockGetSyncJobById).not.toHaveBeenCalled()
    expect(mockReleaseSyncLock).not.toHaveBeenCalled()
  })

  it('marks a still-running job failed and rethrows when the initial cancellation check fails', async () => {
    const error = new Error('Cancellation lookup unavailable')
    mockIsSyncJobCancelled.mockRejectedValue(error)
    mockGetSyncJobById.mockResolvedValue({ status: 'running' })

    await expect(processRepositoryIdBackfillJobAsync(91, 216)).rejects.toBe(error)

    expect(mockBackfillEligibleWorkflowRunRepositoryIds).not.toHaveBeenCalled()
    expect(mockReleaseSyncLock).toHaveBeenCalledWith(91, 'failed', undefined, 'Cancellation lookup unavailable')
  })

  it('does not release a job that reached a terminal state while the backfill ran', async () => {
    mockBackfillEligibleWorkflowRunRepositoryIds.mockResolvedValue(3)
    mockGetSyncJobById.mockResolvedValue({ status: 'cancelled' })

    await processRepositoryIdBackfillJobAsync(91, 216)

    expect(mockBackfillEligibleWorkflowRunRepositoryIds).toHaveBeenCalledWith(216)
    expect(mockReleaseSyncLock).not.toHaveBeenCalled()
  })

  it('does not overwrite a terminal state when backfill throws after the job stopped running', async () => {
    mockBackfillEligibleWorkflowRunRepositoryIds.mockRejectedValue(new Error('Database unavailable'))
    mockGetSyncJobById.mockResolvedValue({ status: 'cancelled' })

    await expect(processRepositoryIdBackfillJobAsync(91, 216)).rejects.toThrow('Database unavailable')

    expect(mockReleaseSyncLock).not.toHaveBeenCalled()
  })
})
