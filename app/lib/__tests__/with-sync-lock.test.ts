import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Mock the DB sync-jobs module
vi.mock('~/db/sync-jobs.server', () => ({
  acquireSyncLock: vi.fn(),
  releaseSyncLock: vi.fn(),
  logSyncJobMessage: vi.fn(),
}))

// Mock the logger module
vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  runWithJobContext: vi.fn((_lockId: number, _jobType: string, _appId: number, _verbose: boolean, fn: () => unknown) =>
    fn(),
  ),
}))

import { acquireSyncLock, logSyncJobMessage, releaseSyncLock } from '~/db/sync-jobs.server'
import { runWithJobContext } from '~/lib/logger.server'
import { withSyncLock } from '~/lib/sync/with-sync-lock.server'

const mockAcquire = acquireSyncLock as Mock
const mockRelease = releaseSyncLock as Mock
const mockLog = logSyncJobMessage as Mock
const mockRunWithJobContext = runWithJobContext as Mock

describe('withSyncLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns locked:true when lock cannot be acquired', async () => {
    mockAcquire.mockResolvedValue(null)

    const fn = vi.fn()
    const result = await withSyncLock('nais_sync', 1, { startMessage: 'Start', resultMessage: 'Done' }, fn)

    expect(result).toEqual({ success: false, locked: true })
    expect(fn).not.toHaveBeenCalled()
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('executes fn and returns result on success', async () => {
    mockAcquire.mockResolvedValue(42)
    mockLog.mockResolvedValue(undefined)
    mockRelease.mockResolvedValue(undefined)

    const result = await withSyncLock(
      'nais_sync',
      1,
      { startMessage: 'Starting sync', resultMessage: 'Sync done' },
      async () => ({ newCount: 5, skipped: 2 }),
    )

    expect(result).toEqual({ success: true, result: { newCount: 5, skipped: 2 } })
    expect(mockAcquire).toHaveBeenCalledWith('nais_sync', 1, undefined)
    expect(mockRunWithJobContext).toHaveBeenCalledWith(42, 'nais_sync', 1, false, expect.any(Function))
    expect(mockLog).toHaveBeenCalledWith(42, 'info', 'Starting sync', undefined)
    expect(mockLog).toHaveBeenCalledWith(42, 'info', 'Sync done', undefined)
    expect(mockRelease).toHaveBeenCalledWith(42, 'completed', { newCount: 5, skipped: 2 })
  })

  it('passes timeoutMinutes to acquireSyncLock', async () => {
    mockAcquire.mockResolvedValue(99)
    mockRelease.mockResolvedValue(undefined)

    await withSyncLock(
      'github_verify',
      5,
      { timeoutMinutes: 15, startMessage: 'Start', resultMessage: 'Done' },
      async () => ({}),
    )

    expect(mockAcquire).toHaveBeenCalledWith('github_verify', 5, 15)
  })

  it('calls buildResultContext with the result', async () => {
    mockAcquire.mockResolvedValue(10)
    mockRelease.mockResolvedValue(undefined)

    await withSyncLock(
      'nais_sync',
      1,
      {
        startMessage: 'Start',
        resultMessage: 'Done',
        buildResultContext: (r: { count: number }) => ({ total: r.count }),
      },
      async () => ({ count: 7 }),
    )

    expect(mockLog).toHaveBeenCalledWith(10, 'info', 'Done', { total: 7 })
  })

  it('passes startContext to log message', async () => {
    mockAcquire.mockResolvedValue(10)
    mockRelease.mockResolvedValue(undefined)

    await withSyncLock(
      'nais_sync',
      1,
      {
        startMessage: 'Start',
        startContext: { team: 'pensjon', env: 'prod' },
        resultMessage: 'Done',
      },
      async () => ({}),
    )

    expect(mockLog).toHaveBeenCalledWith(10, 'info', 'Start', { team: 'pensjon', env: 'prod' })
  })

  it('logs error, releases with failed status, and rethrows on fn failure', async () => {
    mockAcquire.mockResolvedValue(42)
    mockRelease.mockResolvedValue(undefined)

    const error = new Error('API timeout')

    await expect(
      withSyncLock('nais_sync', 1, { startMessage: 'Start', resultMessage: 'Done' }, async () => {
        throw error
      }),
    ).rejects.toThrow('API timeout')

    expect(mockLog).toHaveBeenCalledWith(42, 'error', 'Feilet: API timeout')
    expect(mockRelease).toHaveBeenCalledWith(42, 'failed', undefined, 'API timeout')
  })

  it('handles non-Error throws gracefully', async () => {
    mockAcquire.mockResolvedValue(42)
    mockRelease.mockResolvedValue(undefined)

    await expect(
      withSyncLock('nais_sync', 1, { startMessage: 'Start', resultMessage: 'Done' }, async () => {
        throw 'string error'
      }),
    ).rejects.toBe('string error')

    expect(mockLog).toHaveBeenCalledWith(42, 'error', 'Feilet: string error')
    expect(mockRelease).toHaveBeenCalledWith(42, 'failed', undefined, 'string error')
  })
})
