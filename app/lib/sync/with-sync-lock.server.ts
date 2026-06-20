import type { SyncJobType } from '~/db/sync-job-types'
import { acquireSyncLock, logSyncJobMessage, releaseSyncLock } from '~/db/sync-jobs.server'
import { runWithJobContext } from '~/lib/logger.server'

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
