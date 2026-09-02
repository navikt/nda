import type { ActiveBoardData } from '~/components/ActiveBoardSection'
import type { AppCardData } from '~/components/AppCard'
import { MyTeamsPage } from '~/components/MyTeamsPage'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getBoardsByDevTeam } from '~/db/boards.server'
import {
  type BoardObjectiveProgress,
  getBoardObjectiveProgress,
  getDevTeamSummaryStats,
} from '~/db/dashboard-stats.server'
import {
  getDevTeamAppsWithIssues,
  getPersonalDeploymentsMissingGoalLinks,
  getUnmappedContributors,
  resolveDevTeamScope,
} from '~/db/deployments/home.server'
import { getUserDevTeamsByRole } from '~/db/role-assignments.server'
import { getActiveGithubAccountByNavIdent } from '~/db/user-github-lookups.server'
import { endOfDay } from '~/lib/date-utils'
import { groupAppCardsByRepo } from '~/lib/group-app-cards'
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

  const githubAccount = await getActiveGithubAccountByNavIdent(identity.navIdent)
  const githubUsername = githubAccount?.github_username ?? null

  const personalMissingGoalLinks = githubUsername ? await getPersonalDeploymentsMissingGoalLinks(githubUsername) : null

  let selectedDevTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> = []
  try {
    selectedDevTeams = await getUserDevTeamsByRole(identity.navIdent)
  } catch {
    // Graceful degradation if role assignments query fails
  }

  if (selectedDevTeams.length === 0) {
    return {
      selectedDevTeams: [],
      teamStats: null,
      issueApps: [] as AppCardData[],
      boardSummaries: [] as {
        board: ActiveBoardData
        objectives: BoardObjectiveProgress[]
        teamBasePath: string
        deploymentsPath: string
        teamName: string
      }[],
      noTeamMembersMapped: false,
      unmappedContributors: [] as string[],
      personalMissingGoalLinks,
      navIdent: identity.navIdent,
      githubUsername,
      isAdmin: identity.role === 'admin',
    }
  }

  const scope = await resolveDevTeamScope(selectedDevTeams)
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  const devTeamIds = selectedDevTeams.map((t) => t.id)

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

  const missingGoalsByKey = new Map<string, number>()
  const unmappedByKey = new Map<string, number>()
  const baselineActionByKey = new Map<string, number>()
  for (const a of issueApps) {
    const key = `${a.team_slug}/${a.environment_name}/${a.app_name}`
    missingGoalsByKey.set(key, a.missing_goal_links)
    unmappedByKey.set(key, a.unmapped_deployer_count)
    baselineActionByKey.set(key, a.baseline_action_count)
  }

  const issueAppCards = groupAppCardsByRepo(
    matchingApps.map((app) => {
      const baseStats = statsByApp.get(app.id) || {
        total: 0,
        with_four_eyes: 0,
        without_four_eyes: 0,
        pending_verification: 0,
        last_deployment: null,
        last_deployment_id: null,
        four_eyes_percentage: 0,
        baseline_action_count: 0,
      }
      return {
        ...app,
        active_repo: activeReposByApp.get(app.id) || null,
        stats: {
          ...baseStats,
          missing_goal_links: missingGoalsByKey.get(`${app.team_slug}/${app.environment_name}/${app.app_name}`) ?? 0,
          unmapped_deployers: unmappedByKey.get(`${app.team_slug}/${app.environment_name}/${app.app_name}`) ?? 0,
          baseline_action_count:
            baselineActionByKey.get(`${app.team_slug}/${app.environment_name}/${app.app_name}`) ??
            baseStats.baseline_action_count ??
            0,
        },
        alertCount: alertCounts.get(app.id) || 0,
      }
    }),
  )

  issueAppCards.sort((a, b) => {
    const aIssues =
      a.stats.without_four_eyes +
      a.alertCount +
      (a.stats.missing_goal_links ?? 0) +
      (a.stats.unmapped_deployers ?? 0) +
      (a.stats.baseline_action_count ?? 0)
    const bIssues =
      b.stats.without_four_eyes +
      b.alertCount +
      (b.stats.missing_goal_links ?? 0) +
      (b.stats.unmapped_deployers ?? 0) +
      (b.stats.baseline_action_count ?? 0)
    return bIssues - aIssues
  })

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
          deploymentsPath: `${teamBasePath}/deployments`,
          teamName: team.name,
        }
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
    isAdmin: identity.role === 'admin',
  }
}

export default function MyTeamsRoute({ loaderData }: Route.ComponentProps) {
  return <MyTeamsPage {...loaderData} />
}
