import { withSyncClient } from '~/db/connection.server'
import { cleanupOldSnapshots } from '~/db/github-data.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { cleanupOldSyncJobs, SYNC_INTERVAL_MS } from '~/db/sync-jobs.server'
import { logger } from '~/lib/logger.server'
import { CHECKS_REVERIFY_LIMIT_PER_APP, reverifyPendingChecks, verifyDeploymentsFourEyes } from './github-verify.server'
import { cacheCheckLogsWithLock } from './log-cache-job.server'
import { syncNewDeploymentsFromNais } from './nais-sync.server'
import { withSyncLock } from './with-sync-lock.server'

let periodicSyncStarted = false

export const VERIFY_LIMIT_PER_APP = 50

const APP_THROTTLE_MS = 250

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

async function runPeriodicSync(): Promise<void> {
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

      for (const app of apps) {
        let didWork = false

        try {
          const syncResult = await syncNewDeploymentsWithLock(app.id, app.team_slug, app.environment_name, app.app_name)

          if (syncResult.locked) {
            lockedCount++
          } else if (syncResult.success) {
            syncedCount++
            newDeploymentsCount += syncResult.result?.newCount || 0
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
          failedCount++
          didWork = true
          logger.error(
            `❌ Sync cycle failed for app ${app.app_name} (${app.team_slug}/${app.environment_name}):`,
            error,
          )
        }

        if (didWork) {
          await new Promise((resolve) => setTimeout(resolve, APP_THROTTLE_MS))
        }
      }

      const cleaned = await cleanupOldSyncJobs(50)
      if (cleaned > 0) {
        logger.info(`🧹 Cleaned up ${cleaned} old sync job records`)
      }

      const cleanedSnapshots = await cleanupOldSnapshots()
      if (
        cleanedSnapshots.prSnapshotsDeleted > 0 ||
        cleanedSnapshots.commitSnapshotsDeleted > 0 ||
        cleanedSnapshots.prRawSnapshotsDeleted > 0 ||
        cleanedSnapshots.compareRawSnapshotsDeleted > 0 ||
        cleanedSnapshots.checksRawSnapshotsDeleted > 0 ||
        cleanedSnapshots.workflowRunsRawSnapshotsDeleted > 0 ||
        cleanedSnapshots.commitRawSnapshotsDeleted > 0 ||
        cleanedSnapshots.commitOnBranchRawSnapshotsDeleted > 0
      ) {
        logger.info(
          `🧹 Cleaned up ${cleanedSnapshots.prSnapshotsDeleted} PR snapshots, ${cleanedSnapshots.commitSnapshotsDeleted} commit snapshots, ${cleanedSnapshots.prRawSnapshotsDeleted} raw PR snapshots, ${cleanedSnapshots.compareRawSnapshotsDeleted} raw compare snapshots, ${cleanedSnapshots.checksRawSnapshotsDeleted} raw checks snapshots, ${cleanedSnapshots.workflowRunsRawSnapshotsDeleted} raw workflow run snapshots, ${cleanedSnapshots.commitRawSnapshotsDeleted} raw commit snapshots, ${cleanedSnapshots.commitOnBranchRawSnapshotsDeleted} raw commit-on-branch snapshots`,
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
        `✅ Periodic sync complete: synced ${syncedCount} apps (${newDeploymentsCount} new deployments), verified ${verifiedCount} deployments, reverified checks for ${checksReverifiedCount} deployments, cached ${cachedLogsCount} logs, ${lockedCount} locked, ${failedCount} failed`,
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
