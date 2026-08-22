import type { KnownBlock } from '@slack/types'

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
  appsWithIssuesCount: number
  withoutFourEyes: number
  pendingVerification: number
  alertCount: number
  missingGoalLinks: number
  unmappedContributors: string[]
}

export interface HomeTabInput {
  slackUserId: string
  githubUsername: string | null | undefined
  navIdent: string | null | undefined
  baseUrl: string
  boards: PersonalHomeTabBoard[]
  teamIssues: PersonalHomeTabTeamIssues
  personalMissingGoalLinks: number | null
}

const MAX_BOARDS_IN_HOME_TAB = 3
const MAX_OBJECTIVES_PER_BOARD = 5

export function buildHomeTabBlocks({
  baseUrl,
  navIdent,
  githubUsername,
  boards,
  teamIssues,
  personalMissingGoalLinks,
}: HomeTabInput): KnownBlock[] {
  const blocks: KnownBlock[] = []

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

function formatKeywordsInline(keywords: string[]): string {
  return keywords.map((k) => `\`${sanitizeForInlineCode(k)}\``).join('  ')
}

function sanitizeForInlineCode(value: string): string {
  return value.replace(/`/g, '').replace(/\r?\n/g, ' ')
}

function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
