import type { ActiveBoardData } from '~/components/ActiveBoardSection'
import type { AppCardData } from '~/components/AppCard'
import { type MyTeamsBoardSummary, MyTeamsPage } from '~/components/MyTeamsPage'
import { getGroupNamesByIds } from '~/db/application-groups.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getBoardsByDevTeam } from '~/db/boards.server'
import { getBoardObjectiveProgress, getDevTeamSummaryStats } from '~/db/dashboard-stats.server'
import {
  getDevTeamAppsWithIssues,
  getPersonalDeploymentsMissingGoalLinks,
  getUnmappedContributors,
  resolveDevTeamScope,
} from '~/db/deployments/home.server'
import { getUserDevTeamsByRole } from '~/db/role-assignments.server'
import { getUserMappingByNavIdent } from '~/db/user-mappings.server'
import { endOfDay } from '~/lib/date-utils'
import { groupAppCards } from '~/lib/group-app-cards'
import { logger } from '~/lib/logger.server'
import { getAppDeploymentStatsBatch } from '../db/deployments.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '../db/monitored-applications.server'
import { requireUser } from '../lib/auth.server'
import type { Route } from './+types/my-teams'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'NDA' }, { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const identity = await requireUser(request)

  // Resolve the user's GitHub username for the personal goal-link query.
  const userMapping = await getUserMappingByNavIdent(identity.navIdent)
  const githubUsername = userMapping?.github_username ?? null

  // Personal "missing goal links" count — mirrors the Slack home tab section.
  // null means the user hasn't mapped a GitHub username yet.
  const personalMissingGoalLinks = githubUsername ? await getPersonalDeploymentsMissingGoalLinks(githubUsername) : null

  // getUserDevTeamsByRole returns teams where user has an assigned role
  let selectedDevTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> = []
  try {
    selectedDevTeams = await getUserDevTeamsByRole(identity.navIdent)
  } catch {
    // Graceful degradation if role assignments query fails
  }

  // If no dev teams selected, return minimal data
  if (selectedDevTeams.length === 0) {
    return {
      selectedDevTeams: [],
      teamStats: null,
      issueApps: [] as AppCardData[],
      boardSummaries: [] as MyTeamsBoardSummary[],
      noTeamMembersMapped: false,
      unmappedContributors: [] as string[],
      personalMissingGoalLinks,
      navIdent: identity.navIdent,
      githubUsername,
    }
  }

  // Resolve scope (nais slugs, app IDs, deployer filter) — shared with Slack
  // home tab so that both views show consistent numbers.
  const scope = await resolveDevTeamScope(selectedDevTeams)
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  // Use board-based team stats with deduplication across all selected teams
  const devTeamIds = selectedDevTeams.map((t) => t.id)

  // Fetch stats, issue apps, unmapped deployers, and boards in parallel
  const [teamStats, issueApps, unmappedContributors, alertCounts, activeReposByApp, ...boardsByTeam] =
    await Promise.all([
      getDevTeamSummaryStats(scope.naisTeamSlugs, scope.directAppIds, ytdStart, scope.deployerUsernames, devTeamIds),
      getDevTeamAppsWithIssues(scope.naisTeamSlugs, scope.directAppIds, scope.deployerUsernames),
      scope.deployerUsernames !== undefined
        ? getUnmappedContributors(scope.naisTeamSlugs, scope.directAppIds, ytdStart)
        : Promise.resolve([] as string[]),
      getAllAlertCounts(),
      getAllActiveRepositories(),
      ...selectedDevTeams.map((t) => getBoardsByDevTeam(t.id)),
    ])

  const allApps = await getAllMonitoredApplications()

  // Build AppCardData for issue apps
  const issueAppKeys = new Set(issueApps.map((a) => `${a.team_slug}/${a.environment_name}/${a.app_name}`))
  const matchingApps = allApps.filter((app) =>
    issueAppKeys.has(`${app.team_slug}/${app.environment_name}/${app.app_name}`),
  )

  const statsByApp =
    matchingApps.length > 0
      ? await getAppDeploymentStatsBatch(
          matchingApps.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })),
          scope.deployerUsernames,
        )
      : new Map()

  // Build a map of missing_goal_links from the issue query
  const missingGoalsByKey = new Map<string, number>()
  const unmappedByKey = new Map<string, number>()
  for (const a of issueApps) {
    const key = `${a.team_slug}/${a.environment_name}/${a.app_name}`
    missingGoalsByKey.set(key, a.missing_goal_links)
    unmappedByKey.set(key, a.unmapped_deployer_count)
  }

  // Resolve group names for grouped app cards
  const groupIds = [
    ...new Set(matchingApps.map((a) => a.application_group_id).filter((id): id is number => id != null)),
  ]
  const groupNames = await getGroupNamesByIds(groupIds)

  const issueAppCards = groupAppCards(
    matchingApps.map((app) => {
      const baseStats = statsByApp.get(app.id) || {
        total: 0,
        with_four_eyes: 0,
        without_four_eyes: 0,
        pending_verification: 0,
        last_deployment: null,
        last_deployment_id: null,
        four_eyes_percentage: 0,
      }
      return {
        ...app,
        active_repo: activeReposByApp.get(app.id) || null,
        stats: {
          ...baseStats,
          missing_goal_links: missingGoalsByKey.get(`${app.team_slug}/${app.environment_name}/${app.app_name}`) ?? 0,
          unmapped_deployers: unmappedByKey.get(`${app.team_slug}/${app.environment_name}/${app.app_name}`) ?? 0,
        },
        alertCount: alertCounts.get(app.id) || 0,
      }
    }),
    groupNames,
  )

  issueAppCards.sort((a, b) => {
    const aIssues =
      a.stats.without_four_eyes + a.alertCount + (a.stats.missing_goal_links ?? 0) + (a.stats.unmapped_deployers ?? 0)
    const bIssues =
      b.stats.without_four_eyes + b.alertCount + (b.stats.missing_goal_links ?? 0) + (b.stats.unmapped_deployers ?? 0)
    return bIssues - aIssues
  })

  // Build board summaries from active boards
  const now = new Date()
  const activeBoards: { board: (typeof boardsByTeam)[0][0]; team: (typeof selectedDevTeams)[0] }[] = []
  for (let i = 0; i < selectedDevTeams.length; i++) {
    const team = selectedDevTeams[i]
    const boards = boardsByTeam[i] ?? []
    for (const board of boards) {
      if (board.is_active && endOfDay(new Date(board.period_end)) >= now) {
        activeBoards.push({ board, team })
      }
    }
  }

  const boardSummaries = await Promise.all(
    activeBoards
      .filter(({ team }) => {
        if (!team.section_slug) {
          logger.warn('Dev team has no section — skipping board display', { teamId: team.id, teamName: team.name })
          return false
        }
        return true
      })
      .map(async ({ board, team }) => {
        const teamBasePath = `/sections/${team.section_slug}/teams/${team.slug}`
        return {
          board: {
            id: board.id,
            period_label: board.period_label,
            period_type: board.period_type,
            period_start: board.period_start,
            period_end: board.period_end,
          } satisfies ActiveBoardData,
          objectives: (await getBoardObjectiveProgress(board.id, undefined)).objectives,
          teamBasePath,
          teamName: team.name,
        } satisfies MyTeamsBoardSummary
      }),
  )

  return {
    selectedDevTeams,
    teamStats,
    issueApps: issueAppCards,
    boardSummaries,
    noTeamMembersMapped: scope.noMembersMapped,
    unmappedContributors,
    personalMissingGoalLinks,
    navIdent: identity.navIdent,
    githubUsername,
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    selectedDevTeams,
    teamStats,
    issueApps,
    boardSummaries,
    noTeamMembersMapped,
    unmappedContributors,
    personalMissingGoalLinks,
    navIdent,
    githubUsername,
  } = loaderData
  const profileId = githubUsername || navIdent

  return (
    <MyTeamsPage
      selectedDevTeams={selectedDevTeams}
      teamStats={teamStats}
      issueApps={issueApps}
      boardSummaries={boardSummaries}
      noTeamMembersMapped={noTeamMembersMapped}
      unmappedContributors={unmappedContributors}
      personalMissingGoalLinks={personalMissingGoalLinks}
      profileId={profileId}
    />
  )
}
