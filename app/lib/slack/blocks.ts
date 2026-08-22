import type { KnownBlock } from '@slack/types'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
  type DeviationFollowUpRole,
  type DeviationIntent,
  type DeviationSeverity,
} from '~/lib/deviation-constants'
import { truncate } from './blocks/shared'

export interface DeploymentNotification {
  deploymentId: number
  appName: string
  environmentName: string
  teamSlug: string
  commitSha: string
  commitMessage?: string
  deployerName: string
  deployerUsername: string
  prNumber?: number
  prUrl?: string
  status: 'unverified' | 'pending_approval' | 'approved' | 'rejected'
  detailsUrl: string
}

export function getStatusEmoji(status: DeploymentNotification['status']): string {
  switch (status) {
    case 'unverified':
      return '⚠️'
    case 'pending_approval':
      return '⏳'
    case 'approved':
      return '✅'
    case 'rejected':
      return '❌'
    default:
      return '📦'
  }
}

function getStatusText(status: DeploymentNotification['status']): string {
  switch (status) {
    case 'unverified':
      return 'Ikke godkjent'
    case 'pending_approval':
      return 'Venter på godkjenning'
    case 'approved':
      return 'Godkjent'
    case 'rejected':
      return 'Avvist'
    default:
      return 'Ukjent'
  }
}

export interface DeviationNotification {
  deploymentId: number
  appName: string
  environmentName: string
  teamSlug: string
  commitSha: string
  reason: string
  breachType?: string
  intent?: string
  severity?: string
  followUpRole?: string
  registeredByName: string
  detailsUrl: string
}

export function buildDeploymentBlocks(notification: DeploymentNotification): KnownBlock[] {
  const shortSha = notification.commitSha.substring(0, 7)
  const statusEmoji = getStatusEmoji(notification.status)
  const statusText = getStatusText(notification.status)

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} Deployment krever oppmerksomhet`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*App:*\n${notification.appName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Miljø:*\n${notification.environmentName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Commit:*\n\`${shortSha}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${statusText}`,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Deployer:*\n${notification.deployerName}`,
        },
        {
          type: 'mrkdwn',
          text: notification.prNumber ? `*PR:*\n<${notification.prUrl}|#${notification.prNumber}>` : '*PR:*\nIngen',
        },
      ],
    },
  ]

  if (notification.commitMessage) {
    const truncatedMessage =
      notification.commitMessage.length > 100
        ? `${notification.commitMessage.substring(0, 100)}...`
        : notification.commitMessage
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Melding:*\n${truncatedMessage}`,
      },
    })
  }

  if (notification.status === 'unverified' || notification.status === 'pending_approval') {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Denne deploymenten mangler godkjenning. Åpne deployment for å verifisere.',
      },
    })
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🔍 Se deployment',
          emoji: true,
        },
        style:
          notification.status === 'unverified' || notification.status === 'pending_approval' ? 'primary' : undefined,
        action_id: 'view_details',
        url: notification.detailsUrl,
      },
    ],
  })

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Team: ${notification.teamSlug} | ID: ${notification.deploymentId}`,
      },
    ],
  })

  return blocks
}

export function buildDeviationBlocks(notification: DeviationNotification): KnownBlock[] {
  const shortSha = notification.commitSha.substring(0, 7)

  const fields = [
    { type: 'mrkdwn' as const, text: `*App:*\n${notification.appName}` },
    { type: 'mrkdwn' as const, text: `*Miljø:*\n${notification.environmentName}` },
    { type: 'mrkdwn' as const, text: `*Commit:*\n\`${shortSha}\`` },
    { type: 'mrkdwn' as const, text: `*Registrert av:*\n${notification.registeredByName}` },
  ]

  if (notification.severity) {
    fields.push({
      type: 'mrkdwn' as const,
      text: `*Alvorlighetsgrad:*\n${DEVIATION_SEVERITY_LABELS[notification.severity as DeviationSeverity] || notification.severity}`,
    })
  }
  if (notification.intent) {
    fields.push({
      type: 'mrkdwn' as const,
      text: `*Intensjon:*\n${DEVIATION_INTENT_LABELS[notification.intent as DeviationIntent] || notification.intent}`,
    })
  }
  if (notification.followUpRole) {
    fields.push({
      type: 'mrkdwn' as const,
      text: `*Oppfølgingsansvarlig:*\n${DEVIATION_FOLLOW_UP_ROLE_LABELS[notification.followUpRole as DeviationFollowUpRole] || notification.followUpRole}`,
    })
  }

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '⚠️ Avvik registrert',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields,
    },
  ]

  if (notification.breachType) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Type brudd:*\n${notification.breachType}`,
      },
    })
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Beskrivelse:*\n${notification.reason}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔍 Se deployment',
            emoji: true,
          },
          action_id: 'view_deviation',
          url: notification.detailsUrl,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Team: ${notification.teamSlug} | Deployment: ${notification.deploymentId}`,
        },
      ],
    },
  )

  return blocks
}

export type {
  HomeTabInput,
  PersonalHomeTabBoard,
  PersonalHomeTabKeyResult,
  PersonalHomeTabObjective,
  PersonalHomeTabTeamIssues,
} from './blocks/home-tab'
export { buildHomeTabBlocks } from './blocks/home-tab'

export interface ReminderDeployment {
  id: number
  commitSha: string
  commitMessage?: string
  deployerName: string
  status: string
  createdAt: string
  detailsUrl: string
}

export interface ReminderNotification {
  appName: string
  environmentName: string
  teamSlug: string
  deployments: ReminderDeployment[]
  deploymentsListUrl: string
}

const REMINDER_DETAIL_LIMIT = 5

export function buildReminderBlocks(notification: ReminderNotification): KnownBlock[] {
  const { appName, environmentName, deployments, deploymentsListUrl } = notification
  const count = deployments.length

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🔔 ${count} deployment${count === 1 ? '' : 's'} mangler godkjenning`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${appName}* (${environmentName})`,
      },
    },
  ]

  if (count <= REMINDER_DETAIL_LIMIT) {
    for (const dep of deployments) {
      const shortSha = dep.commitSha.substring(0, 7)
      const title = dep.commitMessage ? truncate(dep.commitMessage, 60) : `Commit ${shortSha}`
      const statusEmoji = getStatusEmoji(dep.status as DeploymentNotification['status'])

      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${statusEmoji} *<${dep.detailsUrl}|#${dep.id}>* ${title}\n\`${shortSha}\` — ${dep.deployerName} — ${dep.createdAt}`,
          },
        },
      )
    }
  } else {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Det er *${count} deployments* som mangler godkjenning. Gå til deployment-oversikten for å se detaljer.`,
        },
      },
    )
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📋 Se alle deployments',
            emoji: true,
          },
          action_id: 'view_reminder_deployments',
          url: deploymentsListUrl,
          style: 'primary',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Team: ${notification.teamSlug} | Automatisk påminnelse`,
        },
      ],
    },
  )

  return blocks
}

export type { NewDeploymentNotification } from './blocks/new-deployment'
export { buildNewDeploymentBlocks } from './blocks/new-deployment'
