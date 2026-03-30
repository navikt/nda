/**
 * Reminder scheduler for deployment approval reminders.
 *
 * Checks every minute if any app needs a reminder sent.
 * Uses atomic DB updates to prevent duplicate sends across pods.
 */

import { claimReminderSend, getAppsWithRemindersEnabled, getUnapprovedDeployments } from '~/db/deployments.server'
import { getUserMapping } from '~/db/user-mappings.server'
import { logger } from '~/lib/logger.server'
import { getWeekdayKey, isBusinessDay } from './norwegian-holidays'
import type { ReminderDeployment } from './slack'
import { sendReminder } from './slack'

const SCHEDULER_INTERVAL_MS = 60 * 1000 // 1 minute
const MIN_INTERVAL_HOURS = 23 // Minimum hours between reminders per app

let schedulerInterval: ReturnType<typeof setInterval> | null = null

/**
 * Start the reminder scheduler. Checks every minute for apps needing reminders.
 */
export function startReminderScheduler(): void {
  if (schedulerInterval) return
  logger.info('⏰ Starting reminder scheduler (1 min interval)')
  schedulerInterval = setInterval(checkAndSendReminders, SCHEDULER_INTERVAL_MS)
}

/**
 * Stop the reminder scheduler.
 */
function stopReminderScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
    logger.info('⏰ Reminder scheduler stopped')
  }
}

/**
 * Check all apps and send reminders where needed.
 */
async function checkAndSendReminders(): Promise<void> {
  try {
    const now = new Date()

    if (!isBusinessDay(now)) return

    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const currentDay = getWeekdayKey(now)

    const apps = await getAppsWithRemindersEnabled()

    for (const app of apps) {
      if (!app.reminder_days?.includes(currentDay)) continue
      if (!isTimeMatch(app.reminder_time, currentTime)) continue

      await sendReminderForApp(app.id, app.team_slug, app.environment_name, app.app_name, app.slack_channel_id)
    }
  } catch (error) {
    logger.error('Reminder scheduler error:', error)
  }
}

/**
 * Send a reminder for a specific app (called by scheduler or manual trigger).
 * Returns true if a reminder was sent.
 */
export async function sendReminderForApp(
  appId: number,
  teamSlug: string,
  environmentName: string,
  appName: string,
  channelId: string,
): Promise<boolean> {
  // Atomically claim the send (prevents duplicates across pods)
  const claimed = await claimReminderSend(appId, MIN_INTERVAL_HOURS)
  if (!claimed) {
    return false
  }

  const deployments = await getUnapprovedDeployments(appId)
  if (deployments.length === 0) return false

  const baseUrl = process.env.BASE_URL || 'https://pensjon-deployment-audit.ansatt.nav.no'

  const reminderDeployments: ReminderDeployment[] = await Promise.all(
    deployments.map(async (d) => {
      const mapping = d.deployer_username ? await getUserMapping(d.deployer_username) : null
      return {
        id: d.id,
        commitSha: d.commit_sha || '',
        commitMessage: d.title || undefined,
        deployerName: mapping?.display_name || d.deployer_username || 'Ukjent',
        status: d.four_eyes_status,
        createdAt: new Date(d.created_at).toLocaleString('no-NO', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        detailsUrl: `${baseUrl}/team/${teamSlug}/env/${environmentName}/app/${appName}/deployments/${d.id}`,
      }
    }),
  )

  const deploymentsListUrl = `${baseUrl}/team/${teamSlug}/env/${environmentName}/app/${appName}/deployments?status=not_approved&period=all`

  const messageTs = await sendReminder(
    {
      appName,
      environmentName,
      teamSlug,
      deployments: reminderDeployments,
      deploymentsListUrl,
    },
    channelId,
  )

  if (messageTs) {
    logger.info(`🔔 Reminder sent for ${appName} (${environmentName}): ${deployments.length} deployments`)
    return true
  }

  return false
}

/**
 * Check if current time matches configured time (±2 minute window)
 */
export function isTimeMatch(configured: string, current: string): boolean {
  const [confH, confM] = configured.split(':').map(Number)
  const [curH, curM] = current.split(':').map(Number)
  const confMinutes = confH * 60 + confM
  const curMinutes = curH * 60 + curM
  return Math.abs(confMinutes - curMinutes) <= 2
}
