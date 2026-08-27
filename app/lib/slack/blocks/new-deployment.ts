import type { KnownBlock } from '@slack/types'

export interface NewDeploymentNotification {
  deploymentId: number
  appName: string
  environmentName: string
  teamSlug: string
  commitSha: string
  deployerUsername: string
  detailsUrl: string
  fourEyesStatus: string
  prTitle?: string
  prNumber?: number
  prUrl?: string
  prCreator?: string
  prApprovers?: string[]
  prMerger?: string
  branchName?: string
  commitsCount?: number
  deployMethod: 'pull_request' | 'direct_push' | 'legacy'
  /** GitHub username (lowercase) → Slack member ID, for rendering clickable @mentions where a mapping exists. */
  slackMentions?: Record<string, string>
}

/**
 * Renders a GitHub username as a clickable Slack mention (`<@SLACK_ID>`) when a slack_member_id
 * mapping exists for it, falling back to plain text otherwise. Real Slack mentions only work with
 * the `<@USER_ID>` syntax — Slack resolves the display name itself, custom text is not supported.
 */
function formatSlackMention(username: string | undefined, slackMentions?: Record<string, string>): string {
  if (!username) return 'Ukjent'
  const slackId = slackMentions?.[username.toLowerCase()]
  return slackId ? `<@${slackId}>` : username
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

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚀 Ny deployment — ${notification.appName} (${notification.environmentName}) — ${emoji} ${text}`,
        emoji: true,
      },
    },
  ]

  if (notification.prTitle) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${notification.prTitle}*` },
    })

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Opprettet av ${formatSlackMention(notification.prCreator, notification.slackMentions)}\nMerget av ${formatSlackMention(notification.prMerger, notification.slackMentions)}`,
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
  if (notification.prUrl) {
    actionElements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: notification.prNumber ? `Se Pull Request #${notification.prNumber}` : 'Se PR',
        emoji: true,
      },
      action_id: 'view_pr',
      url: notification.prUrl,
    })
  }
  blocks.push({ type: 'actions', elements: actionElements })

  return blocks
}
