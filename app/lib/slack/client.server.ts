/**
 * Slack Integration using Bolt.js with Socket Mode
 *
 * Provides functionality for:
 * - Sending deployment notifications to Slack channels
 * - Interactive buttons for approval/rejection
 * - Updating messages when deployment status changes
 *
 * Environment variables:
 * - SLACK_BOT_TOKEN: Bot User OAuth Token (xoxb-...)
 * - SLACK_APP_TOKEN: App-Level Token for Socket Mode (xapp-...)
 * - SLACK_CHANNEL_ID: Default channel for notifications
 */

import { App, type BlockAction, LogLevel } from '@slack/bolt'
import type { KnownBlock } from '@slack/types'
import {
  claimDeploymentForDeployNotify,
  claimDeploymentForSlackNotification,
  type DeploymentWithApp,
  type GitHubPRData,
  getAppsWithIssues,
  getDeploymentsNeedingDeployNotify,
  getHomeTabSummaryStats,
  getIssueDeploymentsPerApp,
} from '~/db/deployments.server'
import {
  createSlackNotification,
  getSlackNotificationByMessage,
  logSlackInteraction,
  updateSlackNotification,
} from '~/db/slack-notifications.server'
import { getUserMappingBySlackId } from '~/db/user-mappings.server'
import { logger } from '~/lib/logger.server'
import {
  buildDeploymentBlocks,
  buildDeviationBlocks,
  buildHomeTabBlocks,
  buildNewDeploymentBlocks,
  buildReminderBlocks,
  type DeploymentNotification,
  type DeviationNotification,
  getStatusEmoji,
  type NewDeploymentNotification,
  type ReminderNotification,
} from './blocks'

// Re-export types and functions from slack-blocks for backward compatibility
export type {
  DeploymentNotification,
  DeviationNotification,
  HomeTabInput,
  NewDeploymentNotification,
  ReminderNotification,
} from './blocks'
export {
  buildDeploymentBlocks,
  buildDeviationBlocks,
  buildHomeTabBlocks,
  buildNewDeploymentBlocks,
  buildReminderBlocks,
} from './blocks'

// Singleton Slack app instance
let slackApp: App | null = null
let isConnected = false

/**
 * Check if Slack integration is configured
 */
export function isSlackConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN)
}

/**
 * Get or initialize the Slack app instance
 */
function getSlackApp(): App | null {
  if (!isSlackConfigured()) {
    logger.info('[Slack] Not configured (missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN)')
    return null
  }

  if (!slackApp) {
    logger.info('[Slack] Initializing Slack app...')
    slackApp = new App({
      token: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
      logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
    })

    // Register action handlers
    registerActionHandlers(slackApp)
    logger.info('[Slack] Action handlers registered')

    // Register event handlers
    registerEventHandlers(slackApp)
  }

  return slackApp
}

/**
 * Start the Slack Socket Mode connection
 * Should be called once at app startup
 */
export async function startSlackConnection(): Promise<void> {
  if (isConnected) return

  const app = getSlackApp()
  if (!app) {
    logger.info('Slack not configured, skipping connection')
    return
  }

  try {
    await app.start()
    isConnected = true
    logger.info('✅ Slack Socket Mode connection established')
  } catch (error) {
    logger.error('❌ Failed to start Slack connection:', error)
  }
}

/**
 * Stop the Slack connection
 */
async function stopSlackConnection(): Promise<void> {
  if (!isConnected || !slackApp) return

  try {
    await slackApp.stop()
    isConnected = false
    logger.info('Slack connection stopped')
  } catch (error) {
    logger.error('Failed to stop Slack connection:', error)
  }
}

/**
 * Send a deployment notification to Slack
 * Returns the message timestamp (ts) for later updates
 */
export async function sendDeploymentNotification(
  notification: DeploymentNotification,
  channelId?: string,
  sentBy?: string,
): Promise<string | null> {
  const app = getSlackApp()
  if (!app) {
    logger.info('Slack not configured, skipping notification')
    return null
  }

  const channel = channelId || process.env.SLACK_CHANNEL_ID
  if (!channel) {
    logger.error('No Slack channel configured')
    return null
  }

  const blocks = buildDeploymentBlocks(notification)
  const text = `${getStatusEmoji(notification.status)} Deployment: ${notification.appName} (${notification.environmentName})`

  try {
    const result = await app.client.chat.postMessage({
      channel,
      blocks: blocks as KnownBlock[],
      text,
    })

    const messageTs = result.ts
    if (messageTs) {
      // Store notification in database
      await createSlackNotification({
        deploymentId: notification.deploymentId,
        channelId: channel,
        messageTs,
        messageBlocks: blocks as unknown as Record<string, unknown>[],
        messageText: text,
        sentBy,
      })
    }

    return messageTs || null
  } catch (error) {
    logger.error('Failed to send Slack notification:', error)
    return null
  }
}

/**
 * Send a deviation notification to a dedicated Slack channel
 */
export async function sendDeviationNotification(
  notification: DeviationNotification,
  channelId: string,
): Promise<string | null> {
  const app = getSlackApp()
  if (!app) {
    logger.info('Slack not configured, skipping deviation notification')
    return null
  }

  if (!channelId) {
    logger.info('No deviation Slack channel configured, skipping notification')
    return null
  }

  const blocks = buildDeviationBlocks(notification)
  const text = `⚠️ Avvik registrert: ${notification.appName} (${notification.environmentName})`

  try {
    const result = await app.client.chat.postMessage({
      channel: channelId,
      blocks: blocks as KnownBlock[],
      text,
    })
    return result.ts || null
  } catch (error) {
    logger.error('Failed to send deviation Slack notification:', error)
    return null
  }
}

/**
 * Send a reminder notification to a Slack channel
 */
export async function sendReminder(notification: ReminderNotification, channelId: string): Promise<string | null> {
  const app = getSlackApp()
  if (!app) {
    logger.info('Slack not configured, skipping reminder')
    return null
  }

  if (!channelId) {
    logger.info('No Slack channel configured for reminder, skipping')
    return null
  }

  const blocks = buildReminderBlocks(notification)
  const count = notification.deployments.length
  const text = `🔔 ${count} deployment${count === 1 ? '' : 's'} mangler godkjenning — ${notification.appName} (${notification.environmentName})`

  try {
    const result = await app.client.chat.postMessage({
      channel: channelId,
      blocks: blocks as KnownBlock[],
      text,
    })
    return result.ts || null
  } catch (error) {
    logger.error('Failed to send reminder Slack notification:', error)
    return null
  }
}

/**
 * Update an existing deployment notification
 */
async function updateDeploymentNotification(
  messageTs: string,
  notification: DeploymentNotification,
  channelId?: string,
  triggeredBy?: string,
): Promise<boolean> {
  const app = getSlackApp()
  if (!app) return false

  const channel = channelId || process.env.SLACK_CHANNEL_ID
  if (!channel) return false

  const blocks = buildDeploymentBlocks(notification)
  const text = `${getStatusEmoji(notification.status)} Deployment: ${notification.appName} (${notification.environmentName})`

  try {
    await app.client.chat.update({
      channel,
      ts: messageTs,
      blocks: blocks as KnownBlock[],
      text,
    })

    // Log the update in database
    const existing = await getSlackNotificationByMessage(channel, messageTs)
    if (existing) {
      await updateSlackNotification(existing.id, {
        messageBlocks: blocks as unknown as Record<string, unknown>[],
        messageText: text,
        triggeredBy,
      })
    }

    return true
  } catch (error) {
    logger.error('Failed to update Slack notification:', error)
    return false
  }
}

/**
 * Register action handlers for interactive components
 */
function registerActionHandlers(app: App): void {
  // Handle approve button click
  app.action<BlockAction>('approve_deployment', async ({ ack, body, client, action }) => {
    await ack()

    try {
      // Parse the action value
      const buttonAction = action as { value: string }
      const value = JSON.parse(buttonAction.value)
      const { deploymentId, appName } = value

      // Get user info
      const userId = body.user.id

      logger.info(`Slack: User ${userId} approved deployment ${deploymentId}`)

      // Log the interaction
      if (body.channel?.id && body.message?.ts) {
        const notification = await getSlackNotificationByMessage(body.channel.id, body.message.ts)
        if (notification) {
          await logSlackInteraction({
            notificationId: notification.id,
            actionId: 'approve_deployment',
            slackUserId: userId,
            slackUsername: 'username' in body.user ? body.user.username : undefined,
            actionValue: value,
          })
        }

        // TODO: Call the actual approval logic
        // For now, just update the message to show it was approved
        await client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Deployment godkjent*\n\nApp: ${appName}\nGodkjent av: <@${userId}>`,
              },
            },
          ],
          text: `Deployment ${deploymentId} godkjent av ${userId}`,
        })
      }
    } catch (error) {
      logger.error('Error handling approve action:', error)
    }
  })

  // View details is a link button, but we log the interaction
  app.action<BlockAction>('view_details', async ({ ack, body, action }) => {
    await ack()

    try {
      if (body.channel?.id && body.message?.ts) {
        const buttonAction = action as { value?: string }
        const value = buttonAction.value ? JSON.parse(buttonAction.value) : {}

        const notification = await getSlackNotificationByMessage(body.channel.id, body.message.ts)
        if (notification) {
          await logSlackInteraction({
            notificationId: notification.id,
            actionId: 'view_details',
            slackUserId: body.user.id,
            slackUsername: 'username' in body.user ? body.user.username : undefined,
            actionValue: value,
          })
        }
      }
    } catch (error) {
      logger.error('Error logging view_details interaction:', error)
    }
  })
}

/**
 * Send notification for a deployment if needed.
 * Uses atomic database claim to prevent duplicate notifications across pods.
 *
 * @param deployment - Deployment with app info (must include app_slack_channel_id)
 * @param baseUrl - Base URL for links (e.g., https://deployment-audit.ansatt.nav.no)
 * @returns true if notification was sent, false if skipped (already sent or not configured)
 */
export async function notifyDeploymentIfNeeded(
  deployment: {
    id: number
    monitored_app_id: number
    commit_sha: string | null
    deployer_username: string | null
    github_pr_number: number | null
    github_pr_url: string | null
    github_pr_data: { title: string } | null
    four_eyes_status: string
    title: string | null
    slack_message_ts: string | null
    team_slug: string
    environment_name: string
    app_name: string
    app_slack_channel_id?: string | null
    slack_notifications_enabled?: boolean
  },
  baseUrl: string,
): Promise<boolean> {
  // Skip if already notified
  if (deployment.slack_message_ts) {
    return false
  }

  // Skip if Slack not enabled for this app
  if (!deployment.slack_notifications_enabled || !deployment.app_slack_channel_id) {
    return false
  }

  const app = getSlackApp()
  if (!app) {
    return false
  }

  const channelId = deployment.app_slack_channel_id

  // Determine status for notification
  const status = mapFourEyesStatus(deployment.four_eyes_status)

  // Only notify for deployments needing attention
  if (status === 'approved') {
    return false
  }

  // Build notification
  const notification: DeploymentNotification = {
    deploymentId: deployment.id,
    appName: deployment.app_name,
    environmentName: deployment.environment_name,
    teamSlug: deployment.team_slug,
    commitSha: deployment.commit_sha || 'unknown',
    commitMessage: deployment.title || deployment.github_pr_data?.title,
    deployerName: deployment.deployer_username || 'ukjent',
    deployerUsername: deployment.deployer_username || 'unknown',
    prNumber: deployment.github_pr_number || undefined,
    prUrl: deployment.github_pr_url || undefined,
    status,
    detailsUrl: `${baseUrl}/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}`,
  }

  // Send to Slack
  const messageTs = await sendDeploymentNotification(notification, channelId)
  if (!messageTs) {
    return false
  }

  // Atomically claim this deployment (prevents duplicates across pods)
  const claimed = await claimDeploymentForSlackNotification(deployment.id, channelId, messageTs)

  if (!claimed) {
    // Another pod already claimed it - delete our duplicate message
    try {
      await app.client.chat.delete({
        channel: channelId,
        ts: messageTs,
      })
    } catch {
      // Ignore deletion errors
    }
    return false
  }

  logger.info(`Slack notification sent for deployment ${deployment.id} to channel ${channelId}`)
  return true
}

/**
 * Send a new deployment notification to Slack (informational, for ALL deployments).
 * Uses atomic claim pattern to prevent duplicates across pods.
 */
async function notifyNewDeploymentIfNeeded(
  deployment: {
    id: number
    monitored_app_id: number
    commit_sha: string | null
    deployer_username: string | null
    github_pr_number: number | null
    github_pr_url: string | null
    github_pr_data: GitHubPRData | null
    four_eyes_status: string
    title: string | null
    branch_name: string | null
    slack_deploy_message_ts: string | null
    team_slug: string
    environment_name: string
    app_name: string
    slack_deploy_channel_id?: string | null
    slack_deploy_notify_enabled?: boolean
  },
  baseUrl: string,
): Promise<boolean> {
  // Skip if already notified
  if (deployment.slack_deploy_message_ts) {
    return false
  }

  // Skip if deploy notifications not enabled for this app
  if (!deployment.slack_deploy_notify_enabled || !deployment.slack_deploy_channel_id) {
    return false
  }

  const app = getSlackApp()
  if (!app) {
    return false
  }

  const channelId = deployment.slack_deploy_channel_id

  // Determine deploy method
  let deployMethod: NewDeploymentNotification['deployMethod'] = 'direct_push'
  if (deployment.github_pr_number) {
    deployMethod = 'pull_request'
  } else if (deployment.four_eyes_status === 'legacy_verified' || deployment.four_eyes_status === 'implicit_verified') {
    deployMethod = 'legacy'
  }

  // Extract PR metadata
  const prData = deployment.github_pr_data
  const approvers = prData?.reviewers?.filter((r) => r.state === 'APPROVED').map((r) => r.username) ?? []

  const notification: NewDeploymentNotification = {
    deploymentId: deployment.id,
    appName: deployment.app_name,
    environmentName: deployment.environment_name,
    teamSlug: deployment.team_slug,
    commitSha: deployment.commit_sha || 'unknown',
    deployerUsername: deployment.deployer_username || 'ukjent',
    detailsUrl: `${baseUrl}/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}`,
    fourEyesStatus: deployment.four_eyes_status,
    prTitle: prData?.title || deployment.title || undefined,
    prNumber: deployment.github_pr_number || undefined,
    prUrl: deployment.github_pr_url || undefined,
    prCreator: prData?.creator?.username,
    prApprovers: approvers.length > 0 ? approvers : undefined,
    prMerger: prData?.merged_by?.username || prData?.merger?.username,
    branchName: prData?.head_branch || deployment.branch_name || undefined,
    commitsCount: prData?.commits_count,
    deployMethod,
  }

  const blocks = buildNewDeploymentBlocks(notification)
  const text = `🚀 Ny deployment — ${notification.appName} (${notification.environmentName})`

  let messageTs: string | null = null
  try {
    const result = await app.client.chat.postMessage({
      channel: channelId,
      blocks: blocks as KnownBlock[],
      text,
    })
    messageTs = result.ts || null
  } catch (error) {
    logger.error(`Failed to send deploy notification for deployment ${deployment.id}:`, error)
    return false
  }

  if (!messageTs) {
    return false
  }

  // Atomically claim this deployment (prevents duplicates across pods)
  const claimed = await claimDeploymentForDeployNotify(deployment.id, channelId, messageTs)

  if (!claimed) {
    // Another pod already claimed it — delete our duplicate message
    try {
      await app.client.chat.delete({
        channel: channelId,
        ts: messageTs,
      })
    } catch {
      // Ignore deletion errors
    }
    return false
  }

  logger.info(`Deploy notification sent for deployment ${deployment.id} to channel ${channelId}`)
  return true
}

/**
 * Send pending deploy notifications for all deployments that need one.
 * Called from the periodic sync flow after verification completes.
 */
export async function sendPendingDeployNotifications(baseUrl: string): Promise<number> {
  const deployments = await getDeploymentsNeedingDeployNotify()
  if (deployments.length === 0) {
    return 0
  }

  let sentCount = 0
  for (const deployment of deployments) {
    try {
      // The query joins monitored_applications, so these fields exist on the row
      const row = deployment as DeploymentWithApp & {
        slack_deploy_channel_id: string | null
        slack_deploy_notify_enabled: boolean
      }
      const sent = await notifyNewDeploymentIfNeeded(row, baseUrl)
      if (sent) {
        sentCount++
      }
    } catch (error) {
      logger.error(`Failed to send deploy notification for deployment ${deployment.id}:`, error)
    }
  }

  if (sentCount > 0) {
    logger.info(`📬 Sent ${sentCount} deploy notifications`)
  }

  return sentCount
}

/**
 * Map four_eyes_status to notification status
 */
function mapFourEyesStatus(status: string): DeploymentNotification['status'] {
  switch (status) {
    case 'verified':
    case 'legacy_verified':
    case 'implicit_verified':
      return 'approved'
    case 'pending':
    case 'unverified':
      return 'unverified'
    case 'rejected':
      return 'rejected'
    default:
      return 'pending_approval'
  }
}

/**
 * Register event handlers for Slack events
 */
function registerEventHandlers(app: App): void {
  // Handle Home Tab opened
  app.event('app_home_opened', async ({ event, client }) => {
    logger.info('[Slack Home Tab] Event received:', { user: event.user, tab: event.tab })

    try {
      const userId = event.user

      // Try to find matching GitHub username from user mappings using Slack member ID
      logger.info('[Slack Home Tab] Looking up user mapping for Slack ID:', { userId })
      const userMapping = await getUserMappingBySlackId(userId)
      const githubUsername = userMapping?.github_username
      logger.info('[Slack Home Tab] User mapping result:', { githubUsername, hasMapping: !!userMapping })

      // Fetch data for Home Tab
      logger.info('[Slack Home Tab] Fetching data...')

      const [stats, appsWithIssues] = await Promise.all([getHomeTabSummaryStats(), getAppsWithIssues()])

      // Fetch sample issue deployments per app
      const issueDeployments = await getIssueDeploymentsPerApp(appsWithIssues, 3)

      logger.info('[Slack Home Tab] Data fetched:', {
        stats,
        appsWithIssuesCount: appsWithIssues.length,
      })

      // Build and publish Home Tab
      const blocks = buildHomeTabBlocks({
        slackUserId: userId,
        githubUsername,
        baseUrl: process.env.BASE_URL || 'https://pensjon-deployment-audit.ansatt.nav.no',
        stats,
        appsWithIssues,
        issueDeployments,
      })
      logger.info('[Slack Home Tab] Built blocks, count:', { count: blocks.length })

      logger.info('[Slack Home Tab] Publishing view...')
      await client.views.publish({
        user_id: userId,
        view: {
          type: 'home',
          blocks,
        },
      })
      logger.info('[Slack Home Tab] View published successfully')
    } catch (error) {
      logger.error('[Slack Home Tab] Error updating Home Tab:', error)
    }
  })

  logger.info('[Slack] Event handlers registered (app_home_opened)')
}
