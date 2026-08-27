import type { KnownBlock } from '@slack/types'
import { truncate } from './shared'

interface PullRequestInfo {
  number: number
  url?: string
  title: string
  creator?: string
  merger?: string
}

interface NewDeploymentNotificationBase {
  deploymentId: number
  appName: string
  environmentName: string
  teamSlug: string
  commitSha: string
  deployerUsername: string
  detailsUrl: string
  fourEyesStatus: string
  branchName?: string
  commitsCount?: number
  slackMentions?: Record<string, string>
  githubUrl?: string
}

export type NewDeploymentNotification =
  | (NewDeploymentNotificationBase & { deployMethod: 'pull_request'; pr: PullRequestInfo })
  | (NewDeploymentNotificationBase & { deployMethod: 'direct_push' | 'legacy'; pr?: undefined })

const SLACK_MEMBER_ID_PATTERN = /^[UW][A-Z0-9]+$/

function formatSlackMention(username: string | undefined, slackMentions?: Record<string, string>): string {
  if (!username) return 'Ukjent'
  const slackId = slackMentions?.[username.toLowerCase()]
  return slackId && SLACK_MEMBER_ID_PATTERN.test(slackId) ? `<@${slackId}>` : username
}

function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, ' ')
    .replace(/[*_`~\\]/g, ' ')
}

function mapFourEyesStatus(status: string): { emoji: string; text: string } {
  switch (status) {
    case 'approved':
    case 'implicitly_approved':
    case 'manually_approved':
      return { emoji: '✅', text: 'Godkjent' }
    case 'pending':
    case 'pending_baseline':
    case 'unknown':
      return { emoji: '⏳', text: 'Venter' }
    case 'direct_push':
    case 'unverified_commits':
    case 'approved_pr_with_unreviewed':
      return { emoji: '⚠️', text: 'Krever oppfølging' }
    case 'error':
      return { emoji: '❌', text: 'Feil' }
    case 'legacy':
      return { emoji: '📋', text: 'Legacy' }
    default:
      return { emoji: '❓', text: status }
  }
}

export function buildNewDeploymentBlocks(notification: NewDeploymentNotification): KnownBlock[] {
  const { emoji, text } = mapFourEyesStatus(notification.fourEyesStatus)
  const headerText = truncate(
    `🚀 Ny deployment — ${notification.appName} (${notification.environmentName}) — ${emoji} ${text}`,
    147,
  )

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerText,
        emoji: true,
      },
    },
  ]

  if (notification.pr) {
    const safeTitle = escapeMrkdwn(truncate(notification.pr.title, 200))
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${safeTitle}*` },
    })

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Opprettet av ${formatSlackMention(notification.pr.creator, notification.slackMentions)}\nMerget av ${formatSlackMention(notification.pr.merger, notification.slackMentions)}`,
      },
    })
  }

  const actionElements: NonNullable<Extract<KnownBlock, { type: 'actions' }>['elements']> = [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Se deployment', emoji: true },
      style: 'primary' as const,
      action_id: 'view_deploy_details',
      url: notification.detailsUrl,
    },
  ]
  if (notification.pr?.url) {
    actionElements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: `Se Pull Request #${notification.pr.number}`,
        emoji: true,
      },
      action_id: 'view_pr',
      url: notification.pr.url,
    })
  } else if (notification.githubUrl) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Se på GitHub', emoji: true },
      action_id: 'view_github',
      url: notification.githubUrl,
    })
  }
  blocks.push({ type: 'actions', elements: actionElements })

  return blocks
}
