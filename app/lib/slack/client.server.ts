import { App, type BlockAction, LogLevel } from '@slack/bolt'
import type { KnownBlock } from '@slack/types'
import {
  claimDeploymentForDeployNotify,
  claimDeploymentForSlackNotification,
  type DeploymentWithApp,
  type GitHubPRData,
  getDeploymentsNeedingDeployNotify,
} from '~/db/deployments.server'
import {
  createSlackNotification,
  getSlackNotificationByMessage,
  logSlackInteraction,
  updateSlackNotification,
} from '~/db/slack-notifications.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { isApprovedStatus, isLegacyStatus, isNotApprovedStatus, isPendingStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { callSlackApi } from './api-logging.server'
import {
  buildDeploymentBlocks,
  buildDeviationBlocks,
  buildNewDeploymentBlocks,
  buildReminderBlocks,
  type DeploymentNotification,
  type DeviationNotification,
  getStatusEmoji,
  type NewDeploymentNotification,
  type ReminderNotification,
} from './blocks'
import { registerEventHandlers } from './home-tab.server'

let slackApp: App | null = null
let isConnected = false

export function isSlackConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN)
}

function isSlackUserNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    (error as { data?: { error?: string } }).data?.error === 'users_not_found'
  )
}

export class SlackLookupFailedError extends Error {
  constructor(cause: unknown) {
    super('Slack member ID lookup failed')
    this.cause = cause
  }
}

export async function lookupSlackUserIdByEmail(email: string): Promise<string | null> {
  const app = getSlackApp()
  if (!app) return null

  try {
    const result = await callSlackApi('users.lookupByEmail', async () => {
      try {
        return await app.client.users.lookupByEmail({ email })
      } catch (error) {
        if (isSlackUserNotFoundError(error)) {
          return { user: undefined }
        }
        throw error
      }
    })
    return result.user?.id ?? null
  } catch (error) {
    logger.error('Slack users.lookupByEmail failed:', error)
    throw new SlackLookupFailedError(error)
  }
}

/**
 * Resolves the Slack member ID to persist for a mapping. Prefers the auto-detected ID from
 * the user's email over any client-submitted value, so a tampered/stale submitted value can
 * never override a verified match. If the Slack lookup itself fails (e.g. outage), this throws
 * `SlackLookupFailedError` rather than silently falling back to the unverified submitted value.
 */
export async function resolveSlackMemberId(
  email: string | null,
  submittedSlackMemberId: string | null,
): Promise<string | null> {
  if (email && isSlackConfigured()) {
    const autoSlackMemberId = await lookupSlackUserIdByEmail(email)
    if (autoSlackMemberId) return autoSlackMemberId
  }
  return submittedSlackMemberId
}

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

    registerActionHandlers(slackApp)
    logger.info('[Slack] Action handlers registered')

    registerEventHandlers(slackApp)
  }

  return slackApp
}

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

async function _stopSlackConnection(): Promise<void> {
  if (!isConnected || !slackApp) return

  try {
    await slackApp.stop()
    isConnected = false
    logger.info('Slack connection stopped')
  } catch (error) {
    logger.error('Failed to stop Slack connection:', error)
  }
}

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
    const result = await callSlackApi('chat.postMessage', () =>
      app.client.chat.postMessage({
        channel,
        blocks: blocks as KnownBlock[],
        text,
      }),
    )

    const messageTs = result.ts
    if (messageTs) {
      try {
        await createSlackNotification({
          deploymentId: notification.deploymentId,
          channelId: channel,
          messageTs,
          messageBlocks: blocks as unknown as Record<string, unknown>[],
          messageText: text,
          sentBy,
          notificationType: 'approval',
        })
      } catch (historyError) {
        logger.error('Failed to record Slack notification history:', historyError)
      }
    }

    return messageTs || null
  } catch (error) {
    logger.error('Failed to send Slack notification:', error)
    return null
  }
}

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
    const result = await callSlackApi('chat.postMessage', () =>
      app.client.chat.postMessage({
        channel: channelId,
        blocks: blocks as KnownBlock[],
        text,
      }),
    )
    return result.ts || null
  } catch (error) {
    logger.error('Failed to send deviation Slack notification:', error)
    return null
  }
}

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
    const result = await callSlackApi('chat.postMessage', () =>
      app.client.chat.postMessage({
        channel: channelId,
        blocks: blocks as KnownBlock[],
        text,
      }),
    )
    return result.ts || null
  } catch (error) {
    logger.error('Failed to send reminder Slack notification:', error)
    return null
  }
}

async function _updateDeploymentNotification(
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
    await callSlackApi('chat.update', () =>
      app.client.chat.update({
        channel,
        ts: messageTs,
        blocks: blocks as KnownBlock[],
        text,
      }),
    )

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

function registerActionHandlers(app: App): void {
  app.action<BlockAction>('approve_deployment', async ({ ack, body, client, action }) => {
    await ack()

    try {
      const buttonAction = action as { value: string }
      const value = JSON.parse(buttonAction.value)
      const { deploymentId, appName } = value

      const userId = body.user.id

      logger.info(`Slack: User ${userId} approved deployment ${deploymentId}`)

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

        const channelId = body.channel.id
        const messageTs = body.message.ts
        await callSlackApi('chat.update', () =>
          client.chat.update({
            channel: channelId,
            ts: messageTs,
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
          }),
        )
      }
    } catch (error) {
      logger.error('Error handling approve action:', error)
    }
  })

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
  if (deployment.slack_message_ts) {
    return false
  }

  if (!deployment.slack_notifications_enabled || !deployment.app_slack_channel_id) {
    return false
  }

  const app = getSlackApp()
  if (!app) {
    return false
  }

  const channelId = deployment.app_slack_channel_id

  const status = mapFourEyesStatus(deployment.four_eyes_status)

  if (status === 'approved') {
    return false
  }

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

  const messageTs = await sendDeploymentNotification(notification, channelId)
  if (!messageTs) {
    return false
  }

  const claimed = await claimDeploymentForSlackNotification(deployment.id, channelId, messageTs)

  if (!claimed) {
    try {
      await callSlackApi('chat.delete', () =>
        app.client.chat.delete({
          channel: channelId,
          ts: messageTs,
        }),
      )
    } catch {
      // Ignore deletion errors
    }
    return false
  }

  logger.info(`Slack notification sent for deployment ${deployment.id} to channel ${channelId}`)
  return true
}

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
  if (deployment.slack_deploy_message_ts) {
    return false
  }

  if (!deployment.slack_deploy_notify_enabled || !deployment.slack_deploy_channel_id) {
    return false
  }

  const app = getSlackApp()
  if (!app) {
    return false
  }

  const channelId = deployment.slack_deploy_channel_id

  let deployMethod: NewDeploymentNotification['deployMethod'] = 'direct_push'
  if (deployment.github_pr_number) {
    deployMethod = 'pull_request'
  } else if (isLegacyStatus(deployment.four_eyes_status ?? '')) {
    deployMethod = 'legacy'
  }

  const prData = deployment.github_pr_data
  const approvers = prData?.reviewers?.filter((r) => r.state === 'APPROVED').map((r) => r.username) ?? []
  const prCreator = prData?.creator?.username
  const prMerger = prData?.merged_by?.username || prData?.merger?.username

  const mentionUsernames = [...new Set([prCreator, prMerger].filter((u): u is string => !!u))]
  const slackMentions: Record<string, string> = {}
  if (mentionUsernames.length > 0) {
    try {
      const lookups = await getGithubUserLookups(mentionUsernames)
      for (const [username, lookup] of lookups) {
        if (lookup.slack_member_id) {
          slackMentions[username.toLowerCase()] = lookup.slack_member_id
        }
      }
    } catch (error) {
      logger.error(`Failed to resolve Slack mentions for deployment ${deployment.id}:`, error)
    }
  }

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
    prCreator,
    prApprovers: approvers.length > 0 ? approvers : undefined,
    prMerger,
    branchName: prData?.head_branch || deployment.branch_name || undefined,
    commitsCount: prData?.commits_count,
    deployMethod,
    slackMentions: Object.keys(slackMentions).length > 0 ? slackMentions : undefined,
  }

  const blocks = buildNewDeploymentBlocks(notification)
  const text = `🚀 Ny deployment — ${notification.appName} (${notification.environmentName})`

  let messageTs: string | null = null
  try {
    const result = await callSlackApi('chat.postMessage', () =>
      app.client.chat.postMessage({
        channel: channelId,
        blocks: blocks as KnownBlock[],
        text,
      }),
    )
    messageTs = result.ts || null
  } catch (error) {
    logger.error(`Failed to send deploy notification for deployment ${deployment.id}:`, error)
    return false
  }

  if (!messageTs) {
    return false
  }

  const claimed = await claimDeploymentForDeployNotify(deployment.id, channelId, messageTs)

  if (!claimed) {
    try {
      await callSlackApi('chat.delete', () =>
        app.client.chat.delete({
          channel: channelId,
          ts: messageTs,
        }),
      )
    } catch {
      // Ignore deletion errors
    }
    return false
  }

  try {
    await createSlackNotification({
      deploymentId: deployment.id,
      channelId,
      messageTs,
      messageBlocks: blocks as unknown as Record<string, unknown>[],
      messageText: text,
      notificationType: 'deploy',
    })
  } catch (error) {
    logger.error(`Failed to record deploy notification history for deployment ${deployment.id}:`, error)
  }

  logger.info(`Deploy notification sent for deployment ${deployment.id} to channel ${channelId}`)
  return true
}

export async function sendPendingDeployNotifications(baseUrl: string): Promise<number> {
  const deployments = await getDeploymentsNeedingDeployNotify()
  if (deployments.length === 0) {
    return 0
  }

  let sentCount = 0
  for (const deployment of deployments) {
    try {
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

function mapFourEyesStatus(status: string): DeploymentNotification['status'] {
  if (isApprovedStatus(status) || status === 'legacy') return 'approved'
  if (status === 'legacy_pending') return 'pending_approval'
  if (isNotApprovedStatus(status)) return 'unverified'
  if (isPendingStatus(status)) return 'pending_approval'
  return 'pending_approval'
}
