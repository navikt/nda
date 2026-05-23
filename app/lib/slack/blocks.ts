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

export interface PersonalHomeTabKeyResult {
  id: number
  title: string
  keywords: string[]
}

export interface PersonalHomeTabObjective {
  id: number
  title: string
  keywords: string[]
  key_results: PersonalHomeTabKeyResult[]
}

export interface PersonalHomeTabBoard {
  id: number
  period_label: string
  team_name: string
  team_slug: string
  section_slug: string
  objectives: PersonalHomeTabObjective[]
}

export interface PersonalHomeTabTeamIssues {
  /** Number of monitored applications (in the user's dev teams) with at least one open issue. */
  appsWithIssuesCount: number
  withoutFourEyes: number
  pendingVerification: number
  alertCount: number
  missingGoalLinks: number
  unmappedContributors: string[]
}

export interface HomeTabInput {
  slackUserId: string
  /** Resolved from user_mappings; null = no mapping or mapping without GitHub username. */
  githubUsername: string | null | undefined
  /** Resolved from user_mappings; null = no mapping. */
  navIdent: string | null | undefined
  baseUrl: string
  /** Active boards (with goals + key results + keywords) for each dev team the user is on. */
  boards: PersonalHomeTabBoard[]
  /** Aggregated team-scoped approval/alert issues across all the user's dev teams. */
  teamIssues: PersonalHomeTabTeamIssues
  /**
   * Personal-scope: deployments where the user is deployer or PR creator AND the deployment
   * has no goal-link. `null` if the user has no `githubUsername` (cannot be computed).
   */
  personalMissingGoalLinks: number | null
}

/** Cap board count per home view to stay well under Slack's 100-block limit. */
const MAX_BOARDS_IN_HOME_TAB = 3
/** Cap objectives shown per board. */
const MAX_OBJECTIVES_PER_BOARD = 5

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
 * Build blocks for the personalised Slack Home Tab.
 *
 * Layout (no global "ingress"; each section is opt-in):
 * 1. Per dev-team: active boards with mål, nøkkelresultater, kodeord (inline
 *    code) and a "Vis kodeord"-button per KR with keywords (opens a modal
 *    that's easier to copy from than the home tab itself).
 * 2. Team-scoped approval/alert summary with a link to NDA `/my-apps`.
 * 3. Personal-scoped goal-link summary (only when the user has a
 *    `githubUsername`).
 * 4. Friendly fallback when the user is not yet onboarded.
 */
export function buildHomeTabBlocks({
  baseUrl,
  navIdent,
  githubUsername,
  boards,
  teamIssues,
  personalMissingGoalLinks,
}: HomeTabInput): KnownBlock[] {
  const blocks: KnownBlock[] = []

  // --- Onboarding fallback when the user has no NDA mapping at all. ---
  if (!navIdent) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*👋 Velkommen til Deployment Audit!*\n' +
          'Vi fant ikke en kobling fra Slack-brukeren din til NDA. ' +
          'Logg inn i NDA og legg til Slack-IDen din i profilen for å få en personlig oversikt her.',
      },
    })
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Åpne NDA', emoji: true },
          url: baseUrl,
          action_id: 'open_nda_onboarding',
        },
      ],
    })
    return blocks
  }

  // --- Boards section (per dev-team / per board). ---
  const boardsToShow = boards.slice(0, MAX_BOARDS_IN_HOME_TAB)
  const omittedBoards = boards.length - boardsToShow.length

  if (boardsToShow.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*🎯 Ingen aktive måltavler*\n' +
          'Ingen av dine valgte dev-team har en aktiv måltavle. Opprett en tavle i NDA for å koble leveranser til mål.',
      },
    })
  } else {
    for (const board of boardsToShow) {
      const boardUrl = `${baseUrl}/sections/${board.section_slug}/teams/${board.team_slug}/${board.id}`
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🎯 <${boardUrl}|${escapeMrkdwn(board.team_name)} — ${escapeMrkdwn(board.period_label)}>*`,
        },
      })

      const objectivesToShow = board.objectives.slice(0, MAX_OBJECTIVES_PER_BOARD)
      const omittedObjectives = board.objectives.length - objectivesToShow.length

      if (objectivesToShow.length === 0) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: '_Ingen mål er lagt til ennå._' }],
        })
      }

      for (const objective of objectivesToShow) {
        const objLines: string[] = [`*${escapeMrkdwn(objective.title)}*`]
        if (objective.keywords.length > 0) {
          objLines.push(`Kodeord: ${formatKeywordsInline(objective.keywords)}`)
        }
        for (const kr of objective.key_results) {
          objLines.push(`• ${escapeMrkdwn(kr.title)}`)
          if (kr.keywords.length > 0) {
            objLines.push(`   Kodeord: ${formatKeywordsInline(kr.keywords)}`)
          }
        }
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: objLines.join('\n') },
        })
      }

      if (omittedObjectives > 0) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_+ ${omittedObjectives} flere mål — <${boardUrl}|se hele tavla i NDA>_`,
            },
          ],
        })
      }

      blocks.push({ type: 'divider' })
    }

    if (omittedBoards > 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_+ ${omittedBoards} flere måltavler — <${baseUrl}/my-teams|se alle i NDA>_`,
          },
        ],
      })
      blocks.push({ type: 'divider' })
    }
  }

  // --- Team-scoped issue summary (godkjenning + alerts + endringsopphav). ---
  const teamIssueLines: string[] = []
  if (teamIssues.withoutFourEyes > 0) {
    teamIssueLines.push(`• ⚠️ ${teamIssues.withoutFourEyes} deployments uten godkjenning`)
  }
  if (teamIssues.pendingVerification > 0) {
    teamIssueLines.push(`• ⏳ ${teamIssues.pendingVerification} deployments venter verifisering`)
  }
  if (teamIssues.alertCount > 0) {
    teamIssueLines.push(`• 🚨 ${teamIssues.alertCount} åpne varsler`)
  }
  if (teamIssues.missingGoalLinks > 0) {
    teamIssueLines.push(`• 🔗 ${teamIssues.missingGoalLinks} deployments uten endringsopphav`)
  }

  if (teamIssueLines.length > 0) {
    const headerCount = teamIssues.appsWithIssuesCount
    const headerText =
      headerCount > 0
        ? `*🔔 Mine team har ${headerCount} ${headerCount === 1 ? 'applikasjon' : 'applikasjoner'} som trenger oppfølging*`
        : '*🔔 Mine team har deployments som trenger oppfølging*'
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: [headerText, ...teamIssueLines].join('\n') },
    })
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Åpne mine apper i NDA', emoji: true },
          url: `${baseUrl}/my-apps`,
          action_id: 'open_my_apps',
        },
      ],
    })
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*✅ Ingen åpne mangler i mine team*',
      },
    })
  }

  // --- Warning about unmapped deployers. ---
  if (teamIssues.unmappedContributors.length > 0) {
    const count = teamIssues.unmappedContributors.length
    const userList = teamIssues.unmappedContributors.slice(0, 10).join(', ')
    const suffix = count > 10 ? ` og ${count - 10} til` : ''
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*⚠️ ${count} ${count === 1 ? 'deployer mangler' : 'deployere mangler'} brukermapping*\n` +
          `Disse GitHub-brukerne har deployet til teamets apper i år, men er ikke koblet til en NAV-ident: ${userList}${suffix}\n` +
          `Deres deployments telles ikke med i de personfiltrerte tallene over.`,
      },
    })
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Gå til brukermapping', emoji: true },
          url: `${baseUrl}/admin/users`,
          action_id: 'open_user_mapping_unmapped',
        },
      ],
    })
  }

  blocks.push({ type: 'divider' })

  // --- Person-scoped: deployments missing goal-link. ---
  if (personalMissingGoalLinks === null) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*🔗 Endringsopphav*\n' +
          'For å se dine egne deployments som mangler kobling til mål, må du legge til GitHub-brukernavnet ditt i NDA-profilen.',
      },
    })
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Åpne min profil', emoji: true },
          url: `${baseUrl}/users/${navIdent}`,
          action_id: 'open_profile',
        },
      ],
    })
  } else if (personalMissingGoalLinks > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*🔗 ${personalMissingGoalLinks} av dine deployments mangler endringsopphav*\n` +
          'Koble dem til mål eller nøkkelresultater i NDA.',
      },
    })
    const profileUrl = githubUsername
      ? `${baseUrl}/users/${githubUsername}?goal=without_goal`
      : `${baseUrl}/users/${navIdent}?goal=without_goal`
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Koble mine deployments i NDA', emoji: true },
          url: profileUrl,
          action_id: 'open_personal_missing_links',
        },
      ],
    })
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*✅ Alle dine deployments har endringsopphav*',
      },
    })
  }

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

/** Format an array of keywords as space-separated inline-code spans. */
function formatKeywordsInline(keywords: string[]): string {
  return keywords.map((k) => `\`${sanitizeForInlineCode(k)}\``).join('  ')
}

/**
 * Slack mrkdwn has no escape mechanism inside an inline-code span — a literal
 * backtick will close the span and break formatting. Strip backticks (and other
 * format-breaking control characters) before interpolation.
 */
function sanitizeForInlineCode(value: string): string {
  // Remove backticks (would close the inline-code span) and any newlines.
  return value.replace(/`/g, '').replace(/\r?\n/g, ' ')
}

/**
 * Escape characters that Slack mrkdwn treats as HTML entities (`&`, `<`, `>`).
 *
 * Note: this intentionally does NOT escape `*`, `_`, or `~` — the call sites
 * wrap user-supplied text in those characters (e.g. `*${escapeMrkdwn(title)}*`)
 * and need them to retain their formatting meaning. If user content needs to
 * be displayed verbatim, use {@link sanitizeForInlineCode} or a code block.
 */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
