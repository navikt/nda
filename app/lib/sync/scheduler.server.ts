import { withSyncClient } from '~/db/connection.server'
import { cleanupOldSnapshots } from '~/db/github-data.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { cleanupOldSyncJobs, SYNC_INTERVAL_MS } from '~/db/sync-jobs.server'
import { logger } from '~/lib/logger.server'
import { syncRepositoryCodeDeliveries } from './code-delivery-sync.server'
import { CHECKS_REVERIFY_LIMIT_PER_APP, reverifyPendingChecks, verifyDeploymentsFourEyes } from './github-verify.server'
import { cacheCheckLogsWithLock } from './log-cache-job.server'
import { syncNaisApplyActivityFromNais, syncNewDeploymentsFromNais } from './nais-sync.server'
import { withSyncLock } from './with-sync-lock.server'

let periodicSyncStarted = false

export const VERIFY_LIMIT_PER_APP = 50

const APP_THROTTLE_MS = 250

export async function syncNewDeploymentsWithLock(
  monitoredAppId: number,
  teamSlug: string,
  environmentName: string,
  appName: string,
) {
  return withSyncLock(
    'nais_sync',
    monitoredAppId,
    {
      startMessage: `Starter NAIS sync for ${appName}`,
      startContext: { team: teamSlug, env: environmentName },
      resultMessage: 'Sync fullført',
      buildResultContext: (r) => ({
        newCount: r.newCount,
        alertsCreated: r.alertsCreated,
        stoppedEarly: r.stoppedEarly,
        naisApplyActivityCount: r.naisApplyActivityCount,
        ...(r.initialHistorySyncStatus
          ? {
              initialHistorySyncStatus: r.initialHistorySyncStatus,
              ...(r.initialHistorySyncReason ? { initialHistorySyncReason: r.initialHistorySyncReason } : {}),
            }
          : {}),
      }),
    },
    async () => {
      const legacySync = await syncNewDeploymentsFromNais(teamSlug, environmentName, appName, monitoredAppId).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      )
      const applyActivitySync = await syncNaisApplyActivityFromNais(monitoredAppId).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      )

      if (applyActivitySync.status === 'rejected') {
        logger.error(
          `❌ Nais Apply activity sync failed for app ${appName} (${teamSlug}/${environmentName}); continuing with legacy deployments:`,
          applyActivitySync.reason,
        )
      }
      if (legacySync.status === 'rejected') {
        if (applyActivitySync.status === 'rejected') {
          throw new AggregateError([legacySync.reason, applyActivitySync.reason], 'Nais source synchronization failed')
        }
        throw legacySync.reason
      }

      return {
        ...legacySync.value,
        naisApplyActivityCount: applyActivitySync.status === 'fulfilled' ? applyActivitySync.value : 0,
      }
    },
  )
}

export async function verifyDeploymentsWithLock(monitoredAppId: number, limit?: number) {
  return withSyncLock(
    'github_verify',
    monitoredAppId,
    {
      timeoutMinutes: 15,
      startMessage: 'Starter GitHub verifisering',
      startContext: { limit },
      resultMessage: 'Verifisering fullført',
      buildResultContext: (r) => ({
        verified: r.verified,
        failed: r.failed,
        skipped: r.skipped,
        remaining: r.remaining,
      }),
    },
    () => verifyDeploymentsFourEyes({ monitored_app_id: monitoredAppId, limit }),
  )
}

async function reverifyPendingChecksWithLock(monitoredAppId: number, limit: number = CHECKS_REVERIFY_LIMIT_PER_APP) {
  return withSyncLock(
    'checks_reverify',
    monitoredAppId,
    {
      timeoutMinutes: 15,
      startMessage: 'Starter reverifisering av ventende checks',
      startContext: { limit },
      resultMessage: 'Reverifisering av checks fullført',
      buildResultContext: (r) => ({
        fetched: r.fetched,
        errors: r.errors,
      }),
    },
    () => reverifyPendingChecks(monitoredAppId, limit),
  )
}

export async function runPeriodicSync(): Promise<void> {
  try {
    const result = await withSyncClient(async () => {
      logger.info('🔄 Starting periodic sync cycle...')

      const apps = await getAllMonitoredApplications()
      logger.info(`📋 Found ${apps.length} monitored applications`)

      let syncedCount = 0
      let newDeploymentsCount = 0
      let verifiedCount = 0
      let checksReverifiedCount = 0
      let cachedLogsCount = 0
      let lockedCount = 0
      let failedCount = 0
      let initialHistoryPendingCount = 0

      for (const app of apps) {
        let didWork = false
        let appFailed = false

        try {
          let syncResult: Awaited<ReturnType<typeof syncNewDeploymentsWithLock>> | undefined
          try {
            syncResult = await syncNewDeploymentsWithLock(app.id, app.team_slug, app.environment_name, app.app_name)
          } catch (error) {
            appFailed = true
            didWork = true
            logger.error(
              `❌ Nais source synchronization failed for app ${app.app_name} (${app.team_slug}/${app.environment_name}); continuing verification:`,
              error,
            )
          }

          if (syncResult?.locked) {
            lockedCount++
          } else if (syncResult?.success) {
            syncedCount++
            newDeploymentsCount += syncResult.result?.newCount || 0
            if (syncResult.result?.initialHistorySyncStatus === 'pending') {
              initialHistoryPendingCount++
            }
            didWork = true
          }

          const verifyResult = await verifyDeploymentsWithLock(app.id, VERIFY_LIMIT_PER_APP)

          if (verifyResult.success && verifyResult.result) {
            verifiedCount += verifyResult.result.verified
            didWork =
              didWork ||
              verifyResult.result.verified > 0 ||
              verifyResult.result.failed > 0 ||
              verifyResult.result.skipped > 0
          }

          const checksReverifyResult = await reverifyPendingChecksWithLock(app.id)

          if (checksReverifyResult.success && checksReverifyResult.result) {
            checksReverifiedCount += checksReverifyResult.result.fetched
            didWork = didWork || checksReverifyResult.result.fetched > 0
          }

          const cacheResult = await cacheCheckLogsWithLock(app.id)

          if (cacheResult.success && cacheResult.result) {
            cachedLogsCount += cacheResult.result.cached
            didWork = didWork || cacheResult.result.cached > 0
          }
        } catch (error) {
          appFailed = true
          didWork = true
          logger.error(
            `❌ Sync cycle failed for app ${app.app_name} (${app.team_slug}/${app.environment_name}):`,
            error,
          )
        }

        if (appFailed) failedCount++

        if (didWork) {
          await new Promise((resolve) => setTimeout(resolve, APP_THROTTLE_MS))
        }
      }

      try {
        await syncRepositoryCodeDeliveries()
      } catch (error) {
        logger.error('❌ Repository code delivery sync failed:', error)
      }

      const cleaned = await cleanupOldSyncJobs(50)
      if (cleaned > 0) {
        logger.info(`🧹 Cleaned up ${cleaned} old sync job records`)
      }

      const cleanedSnapshots = await cleanupOldSnapshots()
      const totalSnapshotsDeleted = Object.values(cleanedSnapshots.counts).reduce((sum, n) => sum + n, 0)
      if (totalSnapshotsDeleted > 0 || cleanedSnapshots.truncated) {
        const perTable = Object.entries(cleanedSnapshots.counts)
          .filter(([, count]) => count > 0)
          .map(([key, count]) => `${count} ${key}`)
          .join(', ')
        logger.info(
          `🧹 Cleaned up ${totalSnapshotsDeleted} old GitHub snapshot rows${perTable ? ` (${perTable})` : ''}${
            cleanedSnapshots.truncated
              ? ' — avbrutt (batch-/tidsgrense eller tilkoblingsproblem), fortsetter neste kjøring'
              : ''
          }`,
        )
      }

      try {
        const baseUrl = process.env.BASE_URL || 'https://nda.ansatt.nav.no'
        const { sendPendingDeployNotifications } = await import('~/lib/slack/client.server')
        const notified = await sendPendingDeployNotifications(baseUrl)
        if (notified > 0) {
          logger.info(`📬 Sent ${notified} deploy notifications`)
        }
      } catch (error) {
        logger.error('❌ Failed to send deploy notifications:', error)
      }

      logger.info(
        `✅ Periodic sync complete: synced ${syncedCount} apps (${newDeploymentsCount} new deployments), initial Nais history pending for ${initialHistoryPendingCount} apps, verified ${verifiedCount} deployments, reverified checks for ${checksReverifiedCount} deployments, cached ${cachedLogsCount} logs, ${lockedCount} locked, ${failedCount} failed`,
      )
    })

    if (result === null) {
      logger.info('⏳ Another pod holds the sync lock, skipping this cycle')
    }
  } catch (error) {
    logger.error('❌ Periodic sync error:', error)
  }
}

function scheduleNextSync(delayMs: number): void {
  setTimeout(() => {
    runPeriodicSync()
      .catch((err) => logger.error('❌ Periodic sync failed:', err))
      .finally(() => scheduleNextSync(SYNC_INTERVAL_MS))
  }, delayMs)
}

export function startPeriodicSync(): void {
  if (periodicSyncStarted) {
    logger.warn('⚠️ Periodic sync already started')
    return
  }

  periodicSyncStarted = true
  logger.info(`🚀 Starting periodic sync scheduler (interval: ${SYNC_INTERVAL_MS / 1000}s)`)

  scheduleNextSync(10_000)
}
