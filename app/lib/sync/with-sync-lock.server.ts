import type { SyncJobType } from '~/db/sync-job-types'
import {
  acquireSyncLock,
  completeNaisSyncJob,
  heartbeatNaisSyncJob,
  logSyncJobMessage,
  releaseSyncLock,
} from '~/db/sync-jobs.server'
import { logger, runWithJobContext } from '~/lib/logger.server'

const NAIS_SYNC_HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000
const NAIS_SYNC_HEARTBEAT_EXTENSION_MINUTES = 10

export async function withSyncLock<T>(
  jobType: SyncJobType,
  monitoredAppId: number,
  options: {
    timeoutMinutes?: number
    startMessage: string
    startContext?: Record<string, unknown>
    resultMessage: string
    buildResultContext?: (result: T) => Record<string, unknown>
  },
  fn: () => Promise<T>,
): Promise<{ success: boolean; result?: T; locked?: boolean }> {
  const lockId = await acquireSyncLock(jobType, monitoredAppId, options.timeoutMinutes)
  if (typeof lockId !== 'number') {
    return { success: false, locked: true }
  }

  try {
    await logSyncJobMessage(lockId, 'info', options.startMessage, options.startContext)
    const result = await runWithJobContext(lockId, jobType, monitoredAppId, false, async () => {
      if (jobType !== 'nais_sync') return fn()

      let heartbeatInProgress: Promise<void> | undefined
      let heartbeatError: unknown
      let leaseLost = false
      const heartbeat = setInterval(() => {
        if (heartbeatInProgress) return
        heartbeatInProgress = heartbeatNaisSyncJob(lockId, NAIS_SYNC_HEARTBEAT_EXTENSION_MINUTES)
          .then((leaseExtended) => {
            if (!leaseExtended) {
              leaseLost = true
              logger.warn('NAIS sync lease is no longer current; stopping lease heartbeats', { syncJobId: lockId })
              clearInterval(heartbeat)
            } else {
              heartbeatError = undefined
            }
          })
          .catch((error: unknown) => {
            heartbeatError = error
            logger.error('Failed to extend NAIS sync lease', error)
          })
          .finally(() => {
            heartbeatInProgress = undefined
          })
      }, NAIS_SYNC_HEARTBEAT_INTERVAL_MS)

      try {
        const result = await fn()
        await heartbeatInProgress
        if (leaseLost) throw new Error(`NAIS sync lock lease was lost for job ${lockId}`)
        if (heartbeatError) throw heartbeatError
        return result
      } finally {
        clearInterval(heartbeat)
        await heartbeatInProgress
      }
    })
    const resultContext = options.buildResultContext?.(result)
    if (jobType === 'nais_sync') {
      const completed = await completeNaisSyncJob(
        lockId,
        result as Record<string, unknown>,
        options.resultMessage,
        resultContext,
      )
      if (!completed) throw new Error(`NAIS sync lock lease was lost before job ${lockId} could be completed`)
    } else {
      await logSyncJobMessage(lockId, 'info', options.resultMessage, resultContext)
      await releaseSyncLock(lockId, 'completed', result as Record<string, unknown>)
    }
    return { success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logSyncJobMessage(lockId, 'error', `Feilet: ${errorMessage}`)
    await releaseSyncLock(lockId, 'failed', undefined, errorMessage)
    throw error
  }
}
