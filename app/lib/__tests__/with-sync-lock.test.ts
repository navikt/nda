import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/sync-jobs.server', () => ({
  acquireSyncLock: vi.fn(),
  completeNaisSyncJob: vi.fn(),
  heartbeatNaisSyncJob: vi.fn(),
  releaseSyncLock: vi.fn(),
  logSyncJobMessage: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  runWithJobContext: vi.fn((_lockId: number, _jobType: string, _appId: number, _verbose: boolean, fn: () => unknown) =>
    fn(),
  ),
}))

import {
  acquireSyncLock,
  completeNaisSyncJob,
  heartbeatNaisSyncJob,
  logSyncJobMessage,
  releaseSyncLock,
} from '~/db/sync-jobs.server'
import { runWithJobContext } from '~/lib/logger.server'
import { withSyncLock } from '~/lib/sync/with-sync-lock.server'

const mockAcquire = acquireSyncLock as Mock
const mockCompleteNais = completeNaisSyncJob as Mock
const mockHeartbeat = heartbeatNaisSyncJob as Mock
const mockRelease = releaseSyncLock as Mock
const mockLog = logSyncJobMessage as Mock
const mockRunWithJobContext = runWithJobContext as Mock

describe('withSyncLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
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
    mockCompleteNais.mockResolvedValue(true)
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
    expect(mockCompleteNais).toHaveBeenCalledWith(42, { newCount: 5, skipped: 2 }, 'Sync done', undefined)
    expect(mockRelease).not.toHaveBeenCalled()
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

  it('renews the lease for a long-running Nais sync', async () => {
    vi.useFakeTimers()
    mockAcquire.mockResolvedValue(42)
    mockCompleteNais.mockResolvedValue(true)
    mockHeartbeat.mockResolvedValue(true)
    mockRelease.mockResolvedValue(undefined)
    let finishSync: ((value: Record<string, unknown>) => void) | undefined

    const sync = withSyncLock('nais_sync', 1, { startMessage: 'Start', resultMessage: 'Done' }, () => {
      return new Promise<Record<string, unknown>>((resolve) => {
        finishSync = resolve
      })
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

    expect(mockHeartbeat).toHaveBeenCalledWith(42, 10)
    finishSync?.({})
    await expect(sync).resolves.toEqual({ success: true, result: {} })
    expect(mockCompleteNais).toHaveBeenCalledWith(42, {}, 'Done', undefined)
  })

  it('does not heartbeat non-NAIS sync jobs', async () => {
    mockAcquire.mockResolvedValue(42)
    mockCompleteNais.mockResolvedValue(true)
    mockRelease.mockResolvedValue(undefined)

    await withSyncLock('github_verify', 1, { startMessage: 'Start', resultMessage: 'Done' }, async () => ({}))

    expect(mockHeartbeat).not.toHaveBeenCalled()
  })

  it('fails a Nais sync when it loses its lease', async () => {
    vi.useFakeTimers()
    mockAcquire.mockResolvedValue(42)
    mockHeartbeat.mockResolvedValue(false)
    mockRelease.mockResolvedValue(undefined)
    let finishSync: (() => void) | undefined

    const sync = withSyncLock('nais_sync', 1, { startMessage: 'Start', resultMessage: 'Done' }, () => {
      return new Promise<void>((resolve) => {
        finishSync = resolve
      })
    })

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    finishSync?.()

    await expect(sync).rejects.toThrow('NAIS sync lock lease was lost for job 42')
    expect(mockRelease).toHaveBeenCalledWith(42, 'failed', undefined, 'NAIS sync lock lease was lost for job 42')
  })

  it('fails when the Nais job can no longer be atomically completed', async () => {
    mockAcquire.mockResolvedValue(42)
    mockCompleteNais.mockResolvedValue(false)
    mockRelease.mockResolvedValue(false)

    await expect(
      withSyncLock('nais_sync', 1, { startMessage: 'Start', resultMessage: 'Done' }, async () => ({ count: 1 })),
    ).rejects.toThrow('NAIS sync lock lease was lost before job 42 could be completed')

    expect(mockCompleteNais).toHaveBeenCalledWith(42, { count: 1 }, 'Done', undefined)
    expect(mockRelease).toHaveBeenCalledWith(
      42,
      'failed',
      undefined,
      'NAIS sync lock lease was lost before job 42 could be completed',
    )
  })

  it('calls buildResultContext with the result', async () => {
    mockAcquire.mockResolvedValue(10)
    mockCompleteNais.mockResolvedValue(true)
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

    expect(mockCompleteNais).toHaveBeenCalledWith(10, { count: 7 }, 'Done', { total: 7 })
  })

  it('passes startContext to log message', async () => {
    mockAcquire.mockResolvedValue(10)
    mockRelease.mockResolvedValue(undefined)

    await withSyncLock(
      'github_verify',
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
      withSyncLock('github_verify', 1, { startMessage: 'Start', resultMessage: 'Done' }, async () => {
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
      withSyncLock('github_verify', 1, { startMessage: 'Start', resultMessage: 'Done' }, async () => {
        throw 'string error'
      }),
    ).rejects.toBe('string error')

    expect(mockLog).toHaveBeenCalledWith(42, 'error', 'Feilet: string error')
    expect(mockRelease).toHaveBeenCalledWith(42, 'failed', undefined, 'string error')
  })
})
