import { BarChartIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, LinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import type { ReactNode } from 'react'
import { Link, useRouteLoaderData } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getBoardsByDevTeam } from '~/db/boards.server'
import {
  type BoardObjectiveProgress,
  getBoardObjectiveProgress,
  getDevTeamSummaryStats,
} from '~/db/dashboard-stats.server'
import { getDevTeamAppsWithIssues } from '~/db/deployments/home.server'
import { getDevTeamApplications } from '~/db/dev-teams.server'
import { getUserDevTeams } from '~/db/user-dev-team-preference.server'
import { groupAppCards } from '~/lib/group-app-cards'
import { getAppDeploymentStatsBatch } from '../db/deployments.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '../db/monitored-applications.server'
import { requireUser } from '../lib/auth.server'
import type { Route } from './+types/my-teams'
import type { loader as layoutLoader } from './layout'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'NDA' }, { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' }]
}

interface BoardSummary {
  boardId: number
  boardTitle: string
  periodLabel: string
  teamName: string
  teamSlug: string
  sectionSlug: string
  objectives: BoardObjectiveProgress[]
}

export async function loader({ request }: Route.LoaderArgs) {
  const identity = await requireUser(request)

  // getUserDevTeams may fail if migration hasn't run yet
  let selectedDevTeams: Awaited<ReturnType<typeof getUserDevTeams>> = []
  try {
    selectedDevTeams = await getUserDevTeams(identity.navIdent)
  } catch {
    // user_dev_team_preference table may not exist yet
  }

  // If no dev teams selected, return minimal data
  if (selectedDevTeams.length === 0) {
    return {
      selectedDevTeams: [],
      teamStats: null,
      issueApps: [] as AppCardData[],
      boardSummaries: [] as BoardSummary[],
    }
  }

  // Combine nais_team_slugs and direct app IDs from all selected teams
  const allNaisTeamSlugs = [...new Set(selectedDevTeams.flatMap((t) => t.nais_team_slugs))]
  const directAppsResults = await Promise.all(selectedDevTeams.map((t) => getDevTeamApplications(t.id)))
  const allDirectAppIds = [...new Set(directAppsResults.flat().map((a) => a.monitored_app_id))]
  const directAppIds = allDirectAppIds.length > 0 ? allDirectAppIds : undefined
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  // Fetch stats, issue apps, and boards in parallel
  const [teamStats, issueApps, alertCounts, activeReposByApp, ...boardsByTeam] = await Promise.all([
    getDevTeamSummaryStats(allNaisTeamSlugs, directAppIds, ytdStart),
    getDevTeamAppsWithIssues(allNaisTeamSlugs, directAppIds),
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
      ? await getAppDeploymentStatsBatch(matchingApps.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })))
      : new Map()

  const issueAppCards = groupAppCards(
    matchingApps.map((app) => ({
      ...app,
      active_repo: activeReposByApp.get(app.id) || null,
      stats: statsByApp.get(app.id) || {
        total: 0,
        with_four_eyes: 0,
        without_four_eyes: 0,
        pending_verification: 0,
        last_deployment: null,
        last_deployment_id: null,
        four_eyes_percentage: 0,
      },
      alertCount: alertCounts.get(app.id) || 0,
    })),
  )

  issueAppCards.sort((a, b) => {
    const aIssues = a.stats.without_four_eyes + a.alertCount
    const bIssues = b.stats.without_four_eyes + b.alertCount
    return bIssues - aIssues
  })

  // Build board summaries from active boards
  const now = new Date()
  const activeBoards: { board: (typeof boardsByTeam)[0][0]; team: (typeof selectedDevTeams)[0] }[] = []
  for (let i = 0; i < selectedDevTeams.length; i++) {
    const team = selectedDevTeams[i]
    const boards = boardsByTeam[i] ?? []
    for (const board of boards) {
      if (board.is_active && new Date(board.period_end) >= now) {
        activeBoards.push({ board, team })
      }
    }
  }

  const boardSummaries: BoardSummary[] = await Promise.all(
    activeBoards.map(async ({ board, team }) => ({
      boardId: board.id,
      boardTitle: board.title,
      periodLabel: board.period_label,
      teamName: team.name,
      teamSlug: team.slug,
      sectionSlug: team.section_slug ?? '',
      objectives: await getBoardObjectiveProgress(board.id),
    })),
  )

  return {
    selectedDevTeams,
    teamStats,
    issueApps: issueAppCards,
    boardSummaries,
  }
}

function SummaryCard({
  title,
  value,
  icon,
  variant = 'neutral',
}: {
  title: string
  value: string | number
  icon: ReactNode
  variant?: 'success' | 'warning' | 'error' | 'neutral'
}) {
  const bgMap = {
    success: 'success-soft' as const,
    warning: 'warning-soft' as const,
    error: 'danger-soft' as const,
    neutral: 'neutral-soft' as const,
  }

  return (
    <Box padding="space-20" borderRadius="8" background={bgMap[variant]}>
      <VStack gap="space-4">
        <HStack gap="space-8" align="center">
          {icon}
          <Detail textColor="subtle">{title}</Detail>
        </HStack>
        <Heading size="large" level="3">
          {value}
        </Heading>
      </VStack>
    </Box>
  )
}

function formatCoverage(percentage: number): string {
  if (percentage > 0 && percentage < 1) return '<1%'
  if (percentage > 99 && percentage < 100) return '99%'
  return `${percentage}%`
}

function getHealthVariant(percentage: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (percentage >= 90) return 'success'
  if (percentage >= 70) return 'warning'
  if (percentage > 0) return 'error'
  return 'neutral'
}

function getHealthLabel(fourEyesPct: number, goalPct: number): string {
  const min = Math.min(fourEyesPct, goalPct)
  if (min >= 90) return 'God'
  if (min >= 70) return 'Akseptabel'
  if (min > 0) return 'Trenger oppfølging'
  return 'Ingen data'
}

function getHealthIcon(fourEyesPct: number, goalPct: number): ReactNode {
  const min = Math.min(fourEyesPct, goalPct)
  if (min >= 70) return <CheckmarkCircleIcon aria-hidden />
  return <ExclamationmarkTriangleIcon aria-hidden />
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { selectedDevTeams, teamStats, issueApps, boardSummaries } = loaderData
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/layout')
  const githubUsername = layoutData?.user?.githubUsername
  const navIdent = layoutData?.user?.navIdent
  const profileId = githubUsername || navIdent

  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="xlarge" spacing>
          Mine team
        </Heading>
        <BodyShort textColor="subtle">Helsetilstand for dine utviklingsteam</BodyShort>
      </div>

      {/* No teams — prompt to set up profile */}
      {selectedDevTeams.length === 0 && (
        <Alert variant="info">
          <VStack gap="space-8">
            <BodyShort>
              Du har ikke valgt noen utviklingsteam ennå. Gå til profilen din for å velge hvilke team du tilhører.
            </BodyShort>
            {profileId && (
              <div>
                <Button as={Link} to={`/users/${profileId}`} size="small" variant="secondary">
                  Min profil
                </Button>
              </div>
            )}
          </VStack>
        </Alert>
      )}

      {/* Teams selected — show combined overview */}
      {selectedDevTeams.length > 0 && teamStats && (
        <VStack gap="space-24">
          {/* Summary cards */}
          <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
            <SummaryCard
              title="Deployments i år"
              value={teamStats.total_deployments}
              icon={<BarChartIcon aria-hidden />}
            />
            <SummaryCard
              title="4-øyne dekning"
              value={formatCoverage(teamStats.four_eyes_percentage)}
              icon={<CheckmarkCircleIcon aria-hidden />}
              variant={getHealthVariant(teamStats.four_eyes_percentage)}
            />
            <SummaryCard
              title="Endringsopphav"
              value={formatCoverage(teamStats.goal_percentage)}
              icon={<LinkIcon aria-hidden />}
              variant={getHealthVariant(teamStats.goal_percentage)}
            />
            <SummaryCard
              title="Samlet helsetilstand"
              value={getHealthLabel(teamStats.four_eyes_percentage, teamStats.goal_percentage)}
              icon={getHealthIcon(teamStats.four_eyes_percentage, teamStats.goal_percentage)}
              variant={getHealthVariant(Math.min(teamStats.four_eyes_percentage, teamStats.goal_percentage))}
            />
          </HGrid>

          {/* Navigation links per team */}
          <HStack gap="space-8" wrap>
            <Button as={Link} to="/my-apps" size="small" variant="primary">
              Alle mine applikasjoner
            </Button>
            {selectedDevTeams.map((team) => (
              <Button
                key={team.id}
                as={Link}
                to={`/sections/${team.section_slug}/teams/${team.slug}`}
                size="small"
                variant="secondary"
              >
                {team.name}
              </Button>
            ))}
          </HStack>

          {/* Active boards summary */}
          {boardSummaries.length > 0 && (
            <VStack gap="space-16">
              <Heading level="3" size="small">
                Aktive måltavler
              </Heading>
              <HGrid gap="space-16" columns={{ xs: 1, md: boardSummaries.length === 1 ? 1 : 2 }}>
                {boardSummaries.map((board) => (
                  <BoardSummaryCard key={board.boardId} board={board} />
                ))}
              </HGrid>
            </VStack>
          )}

          {/* Issue apps */}
          {issueApps.length > 0 ? (
            <VStack gap="space-16">
              <Heading level="3" size="small">
                Applikasjoner som trenger oppfølging ({issueApps.length})
              </Heading>
              <div>
                {issueApps.map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </VStack>
          ) : (
            <Alert variant="success">Alle applikasjoner er i orden — ingen krever oppfølging.</Alert>
          )}
        </VStack>
      )}
    </VStack>
  )
}

function BoardSummaryCard({ board }: { board: BoardSummary }) {
  const boardUrl = `/sections/${board.sectionSlug}/teams/${board.teamSlug}/${board.boardId}`
  const totalDeployments = board.objectives.reduce((sum, o) => sum + o.total_linked_deployments, 0)

  return (
    <Box padding="space-20" background="raised" borderRadius="4">
      <VStack gap="space-12">
        <HStack justify="space-between" align="center" wrap>
          <VStack gap="space-4">
            <Link to={boardUrl}>
              <BodyShort weight="semibold">{board.boardTitle}</BodyShort>
            </Link>
            <Detail textColor="subtle">
              {board.teamName} · {board.periodLabel}
            </Detail>
          </VStack>
          <Tag variant="moderate" size="xsmall" data-color="info">
            {totalDeployments} leveranser koblet
          </Tag>
        </HStack>

        {board.objectives.length > 0 ? (
          <VStack gap="space-8">
            {board.objectives.map((obj) => (
              <HStack key={obj.objective_id} gap="space-8" align="start">
                <BodyShort size="small" style={{ flex: 1 }}>
                  {obj.objective_title}
                </BodyShort>
                <Tag
                  variant="moderate"
                  size="xsmall"
                  data-color={obj.total_linked_deployments > 0 ? 'success' : 'neutral'}
                >
                  {obj.total_linked_deployments}
                </Tag>
              </HStack>
            ))}
          </VStack>
        ) : (
          <Detail textColor="subtle">Ingen mål er lagt til ennå.</Detail>
        )}

        <div>
          <Button as={Link} to={boardUrl} size="xsmall" variant="tertiary">
            Åpne tavle
          </Button>
        </div>
      </VStack>
    </Box>
  )
}
