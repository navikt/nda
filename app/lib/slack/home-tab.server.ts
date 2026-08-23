import type { App } from '@slack/bolt'
import { getActiveBoardsWithKeywordsForDevTeam } from '~/db/boards.server'
import { getDevTeamAppsWithIssues, getUnmappedContributors, resolveDevTeamScope } from '~/db/deployments/home.server'
import { getPersonalDeploymentsMissingGoalLinks } from '~/db/deployments.server'
import { getUserDevTeamsByRole } from '~/db/role-assignments.server'
import { getUserBySlackMemberId } from '~/db/user-github-lookups.server'
import { logger } from '~/lib/logger.server'
import { callSlackApi } from './api-logging.server'
import { buildHomeTabBlocks, type PersonalHomeTabBoard, type PersonalHomeTabTeamIssues } from './blocks'

export function registerEventHandlers(app: App): void {
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
    devTeams = []
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
