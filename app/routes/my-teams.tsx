import { BarChartIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, LinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, VStack } from '@navikt/ds-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { type ActiveBoardData, ActiveBoardSection } from '~/components/ActiveBoardSection'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getGroupNamesByIds } from '~/db/application-groups.server'
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
        teamName: string
      }[],
      noTeamMembersMapped: false,
      unmappedContributors: [] as string[],
      personalMissingGoalLinks,
      navIdent: identity.navIdent,
      githubUsername,
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
    groupNames,
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

function formatCoverage(ratio: number): string {
  const pct = Math.round(ratio * 100)
  if (ratio > 0 && pct === 0) return '<1%'
  if (ratio < 1 && pct === 100) return '99%'
  return `${pct}%`
}

function getHealthVariant(ratio: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (ratio >= 1) return 'success'
  if (ratio >= 0.9) return 'warning'
  if (ratio > 0) return 'error'
  return 'neutral'
}

function getHealthLabel(fourEyes: number, goalCoverage: number): string {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 1) return 'God'
  if (min >= 0.9) return 'Akseptabel'
  if (min > 0) return 'Trenger oppfølging'
  return 'Ingen data'
}

function getHealthIcon(fourEyes: number, goalCoverage: number): ReactNode {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 0.9) return <CheckmarkCircleIcon aria-hidden />
  return <ExclamationmarkTriangleIcon aria-hidden />
}

function PersonalGoalStatus({
  personalMissingGoalLinks,
  profileId,
}: {
  personalMissingGoalLinks: number | null
  profileId: string | null | undefined
}) {
  if (personalMissingGoalLinks === null) {
    return (
      <Alert variant="info">
        <VStack gap="space-8">
          <BodyShort>
            For å se dine egne deployments som mangler kobling til mål, må du legge til GitHub-brukernavnet ditt i
            NDA-profilen.
          </BodyShort>
          {profileId && (
            <div>
              <Button as={Link} to={`/users/${profileId}`} size="small" variant="secondary">
                Åpne min profil
              </Button>
            </div>
          )}
        </VStack>
      </Alert>
    )
  }

  if (personalMissingGoalLinks > 0) {
    return (
      <Alert variant="warning">
        <VStack gap="space-8">
          <BodyShort>
            <strong>{personalMissingGoalLinks} av dine deployments mangler endringsopphav.</strong> Koble dem til mål
            eller nøkkelresultater i NDA.
          </BodyShort>
          {profileId && (
            <div>
              <Button as={Link} to={`/users/${profileId}?goal=without_goal`} size="small" variant="secondary">
                Koble mine deployments
              </Button>
            </div>
          )}
        </VStack>
      </Alert>
    )
  }

  return (
    <HStack gap="space-8" align="center">
      <CheckmarkCircleIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
      <BodyShort size="small" textColor="subtle">
        Alle dine deployments har endringsopphav
      </BodyShort>
    </HStack>
  )
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
          {noTeamMembersMapped && (
            <Alert variant="info">
              Ingen av medlemmene i dine team er koblet til en GitHub-bruker, så tallene under er 0. Be teammedlemmene
              registrere GitHub-brukernavn under <Link to="/admin/users">Brukermapping</Link> så blir tallene riktige.
            </Alert>
          )}
          {unmappedContributors.length > 0 && (
            <Alert variant="warning">
              <VStack gap="space-8">
                <BodyShort>
                  {unmappedContributors.length === 1
                    ? '1 deployer i år mangler brukermapping.'
                    : `${unmappedContributors.length} deployere i år mangler brukermapping.`}{' '}
                  Deres deployments telles ikke med i de personfiltrerte tallene under.
                </BodyShort>
                <BodyShort size="small" textColor="subtle">
                  Umappede brukernavn: {unmappedContributors.slice(0, 10).join(', ')}
                  {unmappedContributors.length > 10 && ` og ${unmappedContributors.length - 10} til`}
                </BodyShort>
                <div>
                  <Button as={Link} to="/admin/users" size="small" variant="secondary">
                    Gå til brukermapping
                  </Button>
                </div>
              </VStack>
            </Alert>
          )}
          {/* Summary cards */}
          <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
            <SummaryCard
              title="Deployments i år"
              value={teamStats.total_deployments}
              icon={<BarChartIcon aria-hidden />}
            />
            <SummaryCard
              title="4-øyne dekning"
              value={formatCoverage(teamStats.four_eyes_coverage)}
              icon={<CheckmarkCircleIcon aria-hidden />}
              variant={getHealthVariant(teamStats.four_eyes_coverage)}
            />
            <SummaryCard
              title="Endringsopphav"
              value={formatCoverage(teamStats.goal_coverage)}
              icon={<LinkIcon aria-hidden />}
              variant={getHealthVariant(teamStats.goal_coverage)}
            />
            <SummaryCard
              title="Samlet helsetilstand"
              value={getHealthLabel(teamStats.four_eyes_coverage, teamStats.goal_coverage)}
              icon={getHealthIcon(teamStats.four_eyes_coverage, teamStats.goal_coverage)}
              variant={getHealthVariant(Math.min(teamStats.four_eyes_coverage, teamStats.goal_coverage))}
            />
          </HGrid>
          {/* Navigation links per team */}
          <HStack gap="space-8" wrap>
            <Button as={Link} to="/my-apps" size="small" variant="tertiary">
              Alle mine applikasjoner
            </Button>
            {selectedDevTeams.map((team) => (
              <Button
                key={team.id}
                as={Link}
                to={`/sections/${team.section_slug}/teams/${team.slug}`}
                size="small"
                variant="tertiary"
              >
                {team.name}
              </Button>
            ))}
          </HStack>
          {/* Active boards */}
          {boardSummaries.length > 0 && (
            <VStack gap="space-16">
              <Heading level="3" size="small">
                Aktive måltavler
              </Heading>
              <VStack gap="space-16">
                {boardSummaries.map((bs) => (
                  <ActiveBoardSection
                    key={bs.board.id}
                    board={bs.board}
                    objectives={bs.objectives}
                    teamBasePath={bs.teamBasePath}
                    teamName={bs.teamName}
                    headingLevel="4"
                  />
                ))}
              </VStack>
            </VStack>
          )}
          {/* Combined personal goal + issue apps status */}
          {personalMissingGoalLinks === 0 && issueApps.length === 0 ? (
            <HStack gap="space-8" align="center">
              <CheckmarkCircleIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
              <BodyShort size="small" textColor="subtle">
                Alle dine deployments har endringsopphav og alle applikasjoner er i orden
              </BodyShort>
            </HStack>
          ) : (
            <>
              <PersonalGoalStatus personalMissingGoalLinks={personalMissingGoalLinks} profileId={profileId} />
              {issueApps.length > 0 && (
                <VStack gap="space-16">
                  <Heading level="3" size="small">
                    Applikasjoner som trenger oppfølging ({issueApps.length})
                  </Heading>
                  <div>
                    {issueApps.map((app) => (
                      <AppCard key={app.id} app={app} appendSearchParams="team=mine" />
                    ))}
                  </div>
                </VStack>
              )}
            </>
          )}
        </VStack>
      )}
    </VStack>
  )
}
