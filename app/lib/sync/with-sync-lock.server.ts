import type { SyncJobType } from '~/db/sync-job-types'
import { acquireSyncLock, logSyncJobMessage, releaseSyncLock } from '~/db/sync-jobs.server'
import { runWithJobContext } from '~/lib/logger.server'

/**
 * Generalized distributed lock wrapper for sync jobs.
 * Handles: acquire lock → log start → run job → log result → release lock.
 *
 * @param jobType - The sync job type (e.g., 'nais_sync', 'github_verify', 'cache_check_logs')
 * @param monitoredAppId - The app to lock for
 * @param options.timeoutMinutes - Lock timeout in minutes (default: 5)
 * @param options.startMessage - Log message when starting
 * @param options.startContext - Additional context for start log
 * @param options.resultMessage - Log message when complete
 * @param options.buildResultContext - Extract log context from the result
 * @param fn - The async function to run under the lock
 */
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
  if (!lockId) {
    return { success: false, locked: true }
  }

  try {
    await logSyncJobMessage(lockId, 'info', options.startMessage, options.startContext)
    const result = await runWithJobContext(lockId, jobType, monitoredAppId, false, fn)
    const resultContext = options.buildResultContext?.(result)
    await logSyncJobMessage(lockId, 'info', options.resultMessage, resultContext)
    await releaseSyncLock(lockId, 'completed', result as Record<string, unknown>)
    return { success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logSyncJobMessage(lockId, 'error', `Feilet: ${errorMessage}`)
    await releaseSyncLock(lockId, 'failed', undefined, errorMessage)
    throw error
  }
}
