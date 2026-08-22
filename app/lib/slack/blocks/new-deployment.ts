import type { KnownBlock } from '@slack/types'
import { truncate } from './shared'

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
}

function mapDeployMethod(method: NewDeploymentNotification['deployMethod']): string {
  switch (method) {
    case 'pull_request':
      return 'Pull Request'
    case 'direct_push':
      return 'Direct Push'
    case 'legacy':
      return 'Legacy'
  }
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
  const shortSha = notification.commitSha.substring(0, 7)
  const { emoji: fourEyesEmoji, text: fourEyesText } = mapFourEyesStatus(notification.fourEyesStatus)

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚀 Ny deployment — ${notification.appName}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*App:*\n${notification.appName}` },
        { type: 'mrkdwn', text: `*Miljø:*\n${notification.environmentName}` },
        { type: 'mrkdwn', text: `*Team:*\n${notification.teamSlug}` },
        { type: 'mrkdwn', text: `*Metode:*\n${mapDeployMethod(notification.deployMethod)}` },
      ],
    },
  ]

  if (notification.prTitle) {
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Tittel:*\n${truncate(notification.prTitle, 100)}` },
        { type: 'mrkdwn', text: `*Opprettet av:*\n${notification.prCreator}` },
        {
          type: 'mrkdwn',
          text: `*Godkjent av:*\n${notification.prApprovers && notification.prApprovers.length > 0 ? notification.prApprovers.join(', ') : 'Ingen'}`,
        },
        { type: 'mrkdwn', text: `*Merget av:*\n${notification.prMerger || 'Ukjent'}` },
      ],
    })
  }

  let commitText = `*Commit:*\n\`${shortSha}\``
  if (notification.branchName) {
    commitText += ` on \`${notification.branchName}\``
  }
  if (notification.commitsCount) {
    commitText += `  •  ${notification.commitsCount} commits`
  }
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: commitText },
  })

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Fire øyne:*\n${fourEyesEmoji} ${fourEyesText}`,
    },
  })

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
      text: { type: 'plain_text', text: 'Se PR', emoji: true },
      action_id: 'view_pr',
      url: notification.prUrl,
    })
  }
  blocks.push({ type: 'actions', elements: actionElements })

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Team: ${notification.teamSlug} | Deployment #${notification.deploymentId}`,
      },
    ],
  })

  return blocks
}
