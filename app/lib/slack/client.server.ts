import { App, type BlockAction, LogLevel } from '@slack/bolt'
import type { KnownBlock } from '@slack/types'
import { getActiveBoardsWithKeywordsForDevTeam } from '~/db/boards.server'
import { getDevTeamAppsWithIssues, getUnmappedContributors, resolveDevTeamScope } from '~/db/deployments/home.server'
import {
  claimDeploymentForDeployNotify,
  claimDeploymentForSlackNotification,
  type DeploymentWithApp,
  type GitHubPRData,
  getDeploymentsNeedingDeployNotify,
  getPersonalDeploymentsMissingGoalLinks,
} from '~/db/deployments.server'
import { getUserDevTeamsByRole } from '~/db/role-assignments.server'
import {
  createSlackNotification,
  getSlackNotificationByMessage,
  logSlackInteraction,
  updateSlackNotification,
} from '~/db/slack-notifications.server'
import { getUserBySlackMemberId } from '~/db/user-github-lookups.server'
import { isApprovedStatus, isLegacyStatus, isNotApprovedStatus, isPendingStatus } from '~/lib/four-eyes-status'
import { logger, logOutgoingHttp } from '~/lib/logger.server'
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
  type PersonalHomeTabBoard,
  type PersonalHomeTabTeamIssues,
  type ReminderNotification,
} from './blocks'

let slackApp: App | null = null
let isConnected = false

async function callSlackApi<T>(slackMethod: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    logOutgoingHttp({
      area: 'slack',
      method: 'POST',
      host: 'slack.com',
      path: `/api/${slackMethod}`,
      status_code: 200,
      duration_ms: Date.now() - start,
    })
    return result
  } catch (error) {
    logOutgoingHttp({
      area: 'slack',
      method: 'POST',
      host: 'slack.com',
      path: `/api/${slackMethod}`,
      duration_ms: Date.now() - start,
      error: error instanceof Error ? error.message : 'Slack API error',
    })
    throw error
  }
}

export function isSlackConfigured(): boolean {
  return !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN)
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

function registerEventHandlers(app: App): void {
  app.event('app_home_opened', async ({ event, client }) => {
    logger.info('[Slack Home Tab] Event received:', { user: event.user, tab: event.tab })

    try {
      const userId = event.user
      const baseUrl = process.env.BASE_URL || 'https://nda.ansatt.nav.no'

      const homeTabInput = await buildPersonalizedHomeTabInput({ slackUserId: userId, baseUrl })

      const blocks = buildHomeTabBlocks(homeTabInput)
      logger.info('[Slack Home Tab] Built blocks, count:', { count: blocks.length })

      await callSlackApi('views.publish', () =>
        client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks,
          },
        }),
      )
      logger.info('[Slack Home Tab] View published successfully')
    } catch (error) {
      logger.error('[Slack Home Tab] Error updating Home Tab:', error)
    }
  })

  logger.info('[Slack] Event handlers registered (app_home_opened)')
}

async function buildPersonalizedHomeTabInput({
  slackUserId,
  baseUrl,
}: {
  slackUserId: string
  baseUrl: string
}): Promise<Parameters<typeof buildHomeTabBlocks>[0]> {
  const userData = await getUserBySlackMemberId(slackUserId)
  const navIdent = userData?.nav_ident ?? null
  const githubUsername = userData?.github_username ?? null

  if (!navIdent) {
    return {
      slackUserId,
      navIdent: null,
      githubUsername: null,
      baseUrl,
      boards: [],
      teamIssues: {
        appsWithIssuesCount: 0,
        withoutFourEyes: 0,
        pendingVerification: 0,
        alertCount: 0,
        missingGoalLinks: 0,
        unmappedContributors: [],
      },
      personalMissingGoalLinks: null,
    }
  }

  let devTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> = []
  try {
    devTeams = await getUserDevTeamsByRole(navIdent)
  } catch {
    // Graceful degradation — show onboarding view if role query fails
  }

  const [scope, ...teamBoardResults] = await Promise.all([
    resolveDevTeamScope(devTeams),
    ...devTeams.map((t) => getActiveBoardsWithKeywordsForDevTeam(t.id)),
  ])

  const deployerUsernames = scope.noMembersMapped ? undefined : scope.deployerUsernames
  const deployerFilterActive = deployerUsernames !== undefined
  const [issueApps, unmappedContributors] = await Promise.all([
    getDevTeamAppsWithIssues(scope.naisTeamSlugs, scope.directAppIds, deployerUsernames),
    deployerFilterActive
      ? getUnmappedContributors(scope.naisTeamSlugs, scope.directAppIds)
      : Promise.resolve([] as string[]),
  ])

  const boards: PersonalHomeTabBoard[] = teamBoardResults.flat()
  const teamIssues: PersonalHomeTabTeamIssues = {
    appsWithIssuesCount: issueApps.length,
    withoutFourEyes: 0,
    pendingVerification: 0,
    alertCount: 0,
    missingGoalLinks: 0,
    unmappedContributors,
  }

  for (const app of issueApps) {
    teamIssues.withoutFourEyes += app.without_four_eyes
    teamIssues.pendingVerification += app.pending_verification
    teamIssues.alertCount += app.alert_count
    teamIssues.missingGoalLinks += app.missing_goal_links
  }

  const personalMissingGoalLinks = githubUsername ? await getPersonalDeploymentsMissingGoalLinks(githubUsername) : null

  return {
    slackUserId,
    navIdent,
    githubUsername,
    baseUrl,
    boards,
    teamIssues,
    personalMissingGoalLinks,
  }
}
