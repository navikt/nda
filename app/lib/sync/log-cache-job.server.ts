import { acquireSyncLock, logSyncJobMessage, releaseSyncLock } from '~/db/sync-jobs.server'
import { runWithJobContext } from '~/lib/logger.server'
import { cacheCheckLogs } from './log-cache.server'

/**
 * Cache check logs with distributed locking.
 * Only one pod will cache logs for a given app at a time.
 *
 * Uses direct lock management instead of withSyncLock because it needs
 * per-job diagnostic logging via logSyncJobMessage.
 */
export async function cacheCheckLogsWithLock(
  monitoredAppId: number,
): Promise<{ success: boolean; result?: { cached: number }; locked?: boolean }> {
  const lockId = await acquireSyncLock('cache_check_logs', monitoredAppId, 10)
  if (!lockId) {
    return { success: false, locked: true }
  }

  try {
    await logSyncJobMessage(lockId, 'info', 'Starter caching av sjekk-logger')
    const { cached, diagnostics } = await runWithJobContext(lockId, 'cache_check_logs', monitoredAppId, false, () =>
      cacheCheckLogs(monitoredAppId),
    )

    if (cached === 0) {
      const d = diagnostics
      if (!d.gcsConfigured) {
        await logSyncJobMessage(lockId, 'warn', 'GCS er ikke konfigurert — kan ikke cache logger')
      } else if (d.deploymentsLast7Days === 0) {
        await logSyncJobMessage(lockId, 'info', 'Ingen deployments siste 7 dager')
      } else if (d.deploymentsWithChecks === 0) {
        await logSyncJobMessage(
          lockId,
          'info',
          `${d.deploymentsLast7Days} deployments siste 7 dager, men ingen har checks i github_pr_data (${d.deploymentsWithPrData} har pr_data)`,
        )
      } else {
        await logSyncJobMessage(lockId, 'info', 'Ingen nye logger å cache', {
          deployments_med_checks: d.deploymentsWithChecks,
          checks_totalt: d.checksTotal,
          allerede_cachet: d.skippedAlreadyCached,
          uten_id: d.skippedNoId,
          uten_repo: d.skippedNoRepo,
          ikke_fullført: d.skippedNotCompleted,
        })
      }
    }

    const result = { cached }
    await logSyncJobMessage(lockId, 'info', 'Caching fullført', result)
    await releaseSyncLock(lockId, 'completed', result)
    return { success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await logSyncJobMessage(lockId, 'error', `Caching feilet: ${errorMessage}`)
    await releaseSyncLock(lockId, 'failed', undefined, errorMessage)
    throw error
  }
}
