import { logger } from './lib/logger.server'
import { startReminderScheduler } from './lib/reminder-scheduler.server'
import { registerShutdownHandlers } from './lib/shutdown.server'
import { isSlackConfigured, startSlackConnection } from './lib/slack/client.server'
import { startPeriodicSync } from './lib/sync'

let initialized = false

export function initializeServer(): void {
  if (initialized) return
  initialized = true

  registerShutdownHandlers()

  const enablePeriodicSync = process.env.ENABLE_PERIODIC_SYNC === 'true' || process.env.NODE_ENV === 'production'

  if (enablePeriodicSync) {
    logger.info('🚀 Initializing server-side services...')
    startPeriodicSync()
  } else {
    logger.info('⏸️ Periodic sync disabled (set ENABLE_PERIODIC_SYNC=true to enable)')
  }

  if (isSlackConfigured()) {
    logger.info('🔌 Starting Slack Socket Mode connection...')
    startSlackConnection().catch((err) => {
      logger.error('Failed to start Slack connection:', err)
    })
    startReminderScheduler()
  } else {
    logger.info('💬 Slack not configured (set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to enable)')
  }
}
