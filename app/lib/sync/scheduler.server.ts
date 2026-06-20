import { withSyncClient } from '~/db/connection.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { cleanupOldSyncJobs, SYNC_INTERVAL_MS } from '~/db/sync-jobs.server'
import { logger } from '~/lib/logger.server'
import { verifyDeploymentsFourEyes } from './github-verify.server'
import { cacheCheckLogsWithLock } from './log-cache-job.server'
import { syncNewDeploymentsFromNais } from './nais-sync.server'
import { withSyncLock } from './with-sync-lock.server'

let periodicSyncInterval: ReturnType<typeof setInterval> | null = null
let isPeriodicSyncRunning = false

const VERIFY_LIMIT_PER_APP = 20

async function syncNewDeploymentsWithLock(
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
      }),
    },
    () => syncNewDeploymentsFromNais(teamSlug, environmentName, appName, monitoredAppId),
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
      }),
    },
    () => verifyDeploymentsFourEyes({ monitored_app_id: monitoredAppId, limit }),
  )
}

async function runPeriodicSync(): Promise<void> {
  if (isPeriodicSyncRunning) {
    logger.info('⏳ Periodic sync already running, skipping...')
    return
  }

  isPeriodicSyncRunning = true

  try {
    const result = await withSyncClient(async () => {
      logger.info('🔄 Starting periodic sync cycle...')

      const apps = await getAllMonitoredApplications()
      logger.info(`📋 Found ${apps.length} monitored applications`)

      let syncedCount = 0
      let newDeploymentsCount = 0
      let verifiedCount = 0
      let cachedLogsCount = 0
      let lockedCount = 0

      for (const app of apps) {
        const syncResult = await syncNewDeploymentsWithLock(app.id, app.team_slug, app.environment_name, app.app_name)

        if (syncResult.locked) {
          lockedCount++
        } else if (syncResult.success) {
          syncedCount++
          newDeploymentsCount += syncResult.result?.newCount || 0
        }

        const verifyResult = await verifyDeploymentsWithLock(app.id, VERIFY_LIMIT_PER_APP)

        if (verifyResult.success && verifyResult.result) {
          verifiedCount += verifyResult.result.verified
        }

        const cacheResult = await cacheCheckLogsWithLock(app.id)

        if (cacheResult.success && cacheResult.result) {
          cachedLogsCount += cacheResult.result.cached
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      const cleaned = await cleanupOldSyncJobs(50)
      if (cleaned > 0) {
        logger.info(`🧹 Cleaned up ${cleaned} old sync job records`)
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
        `✅ Periodic sync complete: synced ${syncedCount} apps (${newDeploymentsCount} new deployments), verified ${verifiedCount} deployments, cached ${cachedLogsCount} logs, ${lockedCount} locked`,
      )
    })

    if (result === null) {
      logger.info('⏳ Another pod holds the sync lock, skipping this cycle')
    }
  } catch (error) {
    logger.error('❌ Periodic sync error:', error)
  } finally {
    isPeriodicSyncRunning = false
  }
}

export function startPeriodicSync(): void {
  if (periodicSyncInterval) {
    logger.warn('⚠️ Periodic sync already started')
    return
  }

  logger.info(`🚀 Starting periodic sync scheduler (interval: ${SYNC_INTERVAL_MS / 1000}s)`)

  setTimeout(() => {
    runPeriodicSync().catch((err) => logger.error('❌ Periodic sync failed:', err))
  }, 10_000)

  periodicSyncInterval = setInterval(() => {
    runPeriodicSync().catch((err) => logger.error('❌ Periodic sync failed:', err))
  }, SYNC_INTERVAL_MS)
}
