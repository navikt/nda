import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link, useRouteLoaderData } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getBoardsByDevTeam } from '~/db/boards.server'
import {
  type BoardObjectiveProgress,
  type DevTeamSummaryStats,
  getBoardObjectiveProgress,
  getDevTeamSummaryStats,
} from '~/db/dashboard-stats.server'
import { getDevTeamAppsWithIssues } from '~/db/deployments/home.server'
import { getDevTeamApplications } from '~/db/dev-teams.server'
import { getUserDevTeams } from '~/db/user-dev-team-preference.server'
import { getAppDeploymentStatsBatch } from '../db/deployments.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '../db/monitored-applications.server'
import { requireUser } from '../lib/auth.server'
import type { Route } from './+types/home'
import type { loader as layoutLoader } from './layout'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Deployment Audit' },
    { name: 'description', content: 'Audit Nais deployments for godkjenningsstatus' },
  ]
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

  // Fetch stats, issue apps, and boards in parallel
  const [teamStats, issueApps, alertCounts, activeReposByApp, ...boardsByTeam] = await Promise.all([
    getDevTeamSummaryStats(allNaisTeamSlugs, directAppIds),
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

  const issueAppCards: AppCardData[] = matchingApps.map((app) => ({
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
  }))

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

function TeamStatsCard({ stats }: { stats: DevTeamSummaryStats }) {
  const coverageVariant =
    stats.four_eyes_percentage >= 95 ? 'success' : stats.four_eyes_percentage >= 80 ? 'warning' : 'danger'

  return (
    <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Fireøyne-dekning
          </BodyShort>
          <HStack align="center" gap="space-8">
            <Heading size="large">{stats.four_eyes_percentage}%</Heading>
            <Tag data-color={coverageVariant} variant="moderate" size="xsmall">
              {coverageVariant === 'success' ? 'OK' : coverageVariant === 'warning' ? 'Bør forbedres' : 'Kritisk'}
            </Tag>
          </HStack>
        </VStack>
      </Box>

      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Totalt deployments
          </BodyShort>
          <Heading size="large">{stats.total_deployments}</Heading>
        </VStack>
      </Box>

      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Apper
          </BodyShort>
          <Heading size="large">{stats.total_apps}</Heading>
        </VStack>
      </Box>

      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Apper med problemer
          </BodyShort>
          <HStack align="center" gap="space-8">
            <Heading size="large">{stats.apps_with_issues}</Heading>
            {stats.apps_with_issues > 0 && (
              <Tag data-color="danger" variant="moderate" size="xsmall">
                Krever oppfølging
              </Tag>
            )}
          </HStack>
        </VStack>
      </Box>
    </HGrid>
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { selectedDevTeams, teamStats, issueApps, boardSummaries } = loaderData
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/layout')
  const isAdmin = layoutData?.user?.role === 'admin'
  const githubUsername = layoutData?.user?.githubUsername
  const navIdent = layoutData?.user?.navIdent
  const profileId = githubUsername || navIdent

  return (
    <VStack gap="space-32">
      {/* Admin add-app button */}
      {isAdmin && (
        <HStack justify="end">
          <Button as={Link} to="/apps/add" size="small" variant="secondary">
            Legg til applikasjon
          </Button>
        </HStack>
      )}

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
          {/* Combined stats */}
          <TeamStatsCard stats={teamStats} />

          {/* Navigation links per team */}
          <HStack gap="space-8" wrap>
            {selectedDevTeams.map((team) => (
              <HStack key={team.id} gap="space-8">
                <Button
                  as={Link}
                  to={`/sections/${team.section_slug}/teams/${team.slug}`}
                  size="small"
                  variant="secondary"
                >
                  {team.name}
                </Button>
                {team.nais_team_slugs.map((slug) => (
                  <Button key={slug} as={Link} to={`/team/${slug}`} size="small" variant="secondary">
                    Alle apper ({slug})
                  </Button>
                ))}
              </HStack>
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
                Apper som trenger oppfølging ({issueApps.length})
              </Heading>
              <div>
                {issueApps.map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </VStack>
          ) : (
            <Alert variant="success">Alle apper er i orden — ingen krever oppfølging.</Alert>
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
