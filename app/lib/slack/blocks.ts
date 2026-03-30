/**
 * Slack Block Kit block builders
 *
 * Pure functions that construct Slack Block Kit structures.
 * These are extracted from slack.server.ts to be usable in both
 * server context and browser context (Storybook previews).
 */

import type { KnownBlock } from '@slack/types'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
  type DeviationFollowUpRole,
  type DeviationIntent,
  type DeviationSeverity,
} from '~/lib/deviation-constants'

// =============================================================================
// Types
// =============================================================================

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

export interface HomeTabInput {
  slackUserId: string
  githubUsername: string | null | undefined
  baseUrl: string
  stats: {
    totalApps: number
    totalDeployments: number
    withoutFourEyes: number
    pendingVerification: number
  }
  appsWithIssues: Array<{
    app_name: string
    team_slug: string
    environment_name: string
    without_four_eyes: number
    pending_verification: number
    alert_count: number
  }>
  issueDeployments: Map<
    string,
    Array<{
      id: number
      commit_sha: string | null
      deployer_username: string | null
      four_eyes_status: string
      github_pr_number: number | null
      github_pr_data: { title?: string; creator?: { username?: string } } | null
      title: string | null
      created_at: Date
      app_name: string
      team_slug: string
      environment_name: string
    }>
  >
}

// =============================================================================
// Helpers
// =============================================================================

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
      return 'Uverifisert'
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

// =============================================================================
// Block Builders
// =============================================================================

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text
}

/**
 * Build Slack Block Kit blocks for deployment notification
 */
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

  // Add commit message if available
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

  // Add description and link to app for review
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

  // Add context with timestamp
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

/**
 * Build blocks for deviation notification
 */
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

/**
 * Build blocks for Slack Home Tab
 */
export function buildHomeTabBlocks({ baseUrl, stats, appsWithIssues, issueDeployments }: HomeTabInput): KnownBlock[] {
  const blocks: KnownBlock[] = []

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📊 Deployment Audit',
      emoji: true,
    },
  })

  blocks.push({ type: 'divider' })

  // Section 1: Overview stats
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*📈 Oversikt*',
    },
  })

  blocks.push({
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Overvåkede apper:*\n${stats.totalApps}`,
      },
      {
        type: 'mrkdwn',
        text: `*Totalt deployments:*\n${stats.totalDeployments}`,
      },
      {
        type: 'mrkdwn',
        text: `*⚠️ Mangler godkjenning:*\n${stats.withoutFourEyes}`,
      },
      {
        type: 'mrkdwn',
        text: `*⏳ Venter verifisering:*\n${stats.pendingVerification}`,
      },
    ],
  })

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '🏠 Åpne dashboard',
          emoji: true,
        },
        url: baseUrl,
        action_id: 'open_dashboard',
      },
    ],
  })

  blocks.push({ type: 'divider' })

  // Section 2: Apps with issues + sample deployments
  if (appsWithIssues.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🔔 Applikasjoner med mangler* (${appsWithIssues.length})`,
      },
    })

    for (const app of appsWithIssues) {
      const issues: string[] = []
      if (app.without_four_eyes > 0) {
        issues.push(`⚠️ ${app.without_four_eyes} uten godkjenning`)
      }
      if (app.pending_verification > 0) {
        issues.push(`⏳ ${app.pending_verification} venter verifisering`)
      }
      if (app.alert_count > 0) {
        issues.push(`🚨 ${app.alert_count} varsler`)
      }

      const deploymentsUrl = `${baseUrl}/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/deployments?status=not_approved`
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${deploymentsUrl}|${app.app_name}>* (${app.environment_name})\n${issues.join('  •  ')}`,
        },
      })

      // Show sample deployments with issues for this app
      const key = `${app.team_slug}/${app.environment_name}/${app.app_name}`
      const deployments = issueDeployments.get(key)
      if (deployments && deployments.length > 0) {
        const lines = deployments.map((d) => {
          const shortSha = d.commit_sha?.substring(0, 7) || 'ukjent'
          const deployer = d.deployer_username || 'ukjent'
          const prAuthor = d.github_pr_data?.creator?.username
          const prTitle = d.github_pr_data?.title || d.title
          const prNumber = d.github_pr_number ? `#${d.github_pr_number}` : ''
          const statusEmoji = d.four_eyes_status === 'pending' ? '⏳' : '⚠️'

          let line = `${statusEmoji} \`${shortSha}\``
          if (prNumber && prTitle) {
            line += ` ${prNumber} _${prTitle.substring(0, 50)}${prTitle.length > 50 ? '…' : ''}_`
          }
          line += ` · ${prAuthor || deployer}`
          return line
        })

        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: lines.join('\n'),
            },
          ],
        })
      }
    }

    blocks.push({ type: 'divider' })
  }

  // Footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Oppdatert ${new Date().toLocaleString('nb-NO')}_`,
      },
    ],
  })

  return blocks
}

// =============================================================================
// Reminder Blocks
// =============================================================================

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
  /** URL to the filtered deployment list */
  deploymentsListUrl: string
}

const REMINDER_DETAIL_LIMIT = 5

/**
 * Build Slack Block Kit blocks for a reminder notification.
 * Shows individual deployments if ≤5, otherwise a summary.
 */
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

// =============================================================================
// New Deployment Notification Blocks
// =============================================================================

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

/**
 * Build Slack Block Kit blocks for a new deployment notification
 */
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
