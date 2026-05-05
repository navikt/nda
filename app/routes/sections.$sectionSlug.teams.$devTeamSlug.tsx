import { BarChartIcon, CogIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  HStack,
  LinkCard,
  Switch,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useLoaderData, useRouteLoaderData, useSearchParams } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { BoardSummaryCard } from '~/components/BoardSummaryCard'
import { getGroupNamesByIds } from '~/db/application-groups.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { type Board, getBoardsByDevTeam } from '~/db/boards.server'
import {
  type BoardProgressResult,
  getBoardObjectiveProgress,
  getContributedBoards,
  getDevTeamStats,
} from '~/db/dashboard-stats.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import { getDevTeamApplications, getDevTeamBySlug, getGroupAppIdsForDevTeams } from '~/db/dev-teams.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getSectionBySlug } from '~/db/sections.server'
import {
  type DevTeamMember,
  getDevTeamMembers,
  getMembersGithubUsernamesForDevTeams,
} from '~/db/user-dev-team-preference.server'
import { requireUser } from '~/lib/auth.server'
import { groupAppCards } from '~/lib/group-app-cards'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug'
import type { loader as layoutLoader } from './layout'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }
  const [boards, members, directApps, groupAppIds, allApps, alertCounts, activeRepos, deployerUsernames] =
    await Promise.all([
      getBoardsByDevTeam(devTeam.id),
      getDevTeamMembers(devTeam.id).catch(() => [] as DevTeamMember[]),
      getDevTeamApplications(devTeam.id),
      getGroupAppIdsForDevTeams([devTeam.id]),
      getAllMonitoredApplications(),
      getAllAlertCounts(),
      getAllActiveRepositories(),
      getMembersGithubUsernamesForDevTeams([devTeam.id]).catch(() => [] as string[]),
    ])

  // Top-of-page coverage stats: YTD, filtered to team members' deploys.
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)
  const url = new URL(request.url)
  const showAllApps = url.searchParams.get('allApps') === 'true'
  const showAllBoards = url.searchParams.get('allBoards') === 'true'

  const activeBoard = boards.find((b) => b.is_active) ?? null
  const [activeBoardProgress, contributedBoards, teamStats] = await Promise.all([
    activeBoard ? getBoardObjectiveProgress(activeBoard.id, undefined, { startDate: ytdStart }) : Promise.resolve(null),
    showAllBoards ? getContributedBoards(devTeam.id, deployerUsernames) : Promise.resolve([]),
    getDevTeamStats(devTeam.id, ytdStart),
  ])

  // Build app cards: direct links + group-owned apps + nais team matches
  const directAppIds = new Set([...directApps.map((a) => a.monitored_app_id), ...groupAppIds])
  const naisTeamSlugs = devTeam.nais_team_slugs ?? []
  const teamApps = allApps.filter(
    (app) => app.is_active && (directAppIds.has(app.id) || naisTeamSlugs.includes(app.team_slug)),
  )

  const appsForStats = showAllApps ? allApps.filter((a) => a.is_active) : teamApps

  // Filter stats to deploys made by team members (their GitHub usernames).
  // deployerUsernames is fetched in Promise.all above via getMembersGithubUsernamesForDevTeams
  // (handles soft-deletes, consistent with the deployment list page's team filter).
  // hasMappedMembers and unmappedMemberCount are derived from the members list
  // (not from deployerUsernames which is deduplicated and may not reflect 1:1 mapping).
  const hasMappedMembers = members.some((m) => Boolean(m.github_username))

  const statsByApp =
    appsForStats.length > 0
      ? await getAppDeploymentStatsBatch(
          appsForStats.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })),
          deployerUsernames,
          { startDate: ytdStart },
        )
      : new Map()

  // Derive top-card stats from the board-based team stats function.
  // This guarantees consistency with the section page (same counting logic).
  // Note: total = member deployments (shown per-app below) + non-member board-linked ("Fra andre" card).
  const teamCoverage = {
    total: teamStats.total_deployments,
    with_four_eyes: teamStats.with_four_eyes,
    four_eyes_percentage:
      teamStats.total_deployments > 0
        ? floorUnlessPerfect((teamStats.with_four_eyes / teamStats.total_deployments) * 100)
        : 0,
    with_origin: teamStats.linked_to_goal,
    origin_percentage:
      teamStats.total_deployments > 0
        ? floorUnlessPerfect((teamStats.linked_to_goal / teamStats.total_deployments) * 100)
        : 0,
    non_member_deployments: teamStats.non_member_deployments,
  }

  // Resolve group names for grouped app cards
  const displayApps = showAllApps
    ? appsForStats.filter((app) => {
        const stats = statsByApp.get(app.id)
        return stats && stats.total > 0
      })
    : teamApps
  const teamGroupIds = [
    ...new Set(displayApps.map((a) => a.application_group_id).filter((id): id is number => id != null)),
  ]
  const groupNames = await getGroupNamesByIds(teamGroupIds)

  const appCards: AppCardData[] = groupAppCards(
    displayApps.map((app) => ({
      ...app,
      active_repo: activeRepos.get(app.id) || null,
      stats: statsByApp.get(app.id) || {
        total: 0,
        with_four_eyes: 0,
        without_four_eyes: 0,
        pending_verification: 0,
        missing_goal_links: 0,
        last_deployment: null,
        last_deployment_id: null,
        four_eyes_percentage: 0,
      },
      alertCount: alertCounts.get(app.id) || 0,
    })),
    groupNames,
  ).sort((a, b) => (a.groupName ?? a.app_name).localeCompare(b.groupName ?? b.app_name, 'nb'))

  const section = await getSectionBySlug(params.sectionSlug)

  return {
    devTeam,
    activeBoard,
    activeBoardProgress,
    contributedBoards,
    members,
    appCards,
    showAllApps,
    showAllBoards,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
    teamCoverage,
    hasMappedMembers,
    unmappedMemberCount: members.filter((m) => !m.github_username).length,
  }
}

export default function DevTeamPage() {
  const {
    devTeam,
    activeBoard,
    activeBoardProgress,
    contributedBoards,
    members,
    appCards,
    showAllApps,
    showAllBoards,
    sectionSlug,
    teamCoverage,
    hasMappedMembers,
    unmappedMemberCount,
  } = useLoaderData<typeof loader>()
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/layout')
  const isAdmin = layoutData?.user?.role === 'admin'
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`
  const [searchParams, setSearchParams] = useSearchParams()

  return (
    <VStack gap="space-24">
      <div>
        <HStack align="center" justify="space-between">
          <Heading level="1" size="large">
            {devTeam.name}
          </Heading>
          {isAdmin && (
            <Button
              as={Link}
              to={`${teamBasePath}/admin`}
              variant="tertiary"
              size="small"
              icon={<CogIcon aria-hidden />}
            >
              Administrer
            </Button>
          )}
        </HStack>
        <BodyShort textColor="subtle">Teamside med mål- og commitmentstavler.</BodyShort>
      </div>

      {/* Team-member-based coverage summary */}
      <TeamCoverageCards
        coverage={teamCoverage}
        hasMappedMembers={hasMappedMembers}
        unmappedMemberCount={unmappedMemberCount}
        totalMembers={members.length}
        deploymentsPath={`${teamBasePath}/deployments`}
      />

      {/* Active board */}
      <VStack gap="space-8">
        <HStack align="center" justify="space-between" wrap>
          <Heading level="2" size="small">
            Tavler
          </Heading>
          <Switch
            size="small"
            checked={showAllBoards}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              if (e.target.checked) {
                next.set('allBoards', 'true')
              } else {
                next.delete('allBoards')
              }
              setSearchParams(next)
            }}
          >
            Vis alle tavler med teamaktivitet
          </Switch>
        </HStack>
        {activeBoard ? (
          <ActiveBoardSection board={activeBoard} progress={activeBoardProgress} teamBasePath={teamBasePath} />
        ) : (
          <Alert variant="info">Ingen aktiv tavle. Opprett en ny tavle via Administrer-knappen.</Alert>
        )}
        {showAllBoards && contributedBoards.length > 0 && (
          <VStack gap="space-8">
            <Detail textColor="subtle">Tavler fra andre team som teammedlemmene har bidratt til med leveranser.</Detail>
            <HGrid gap="space-12" columns={{ xs: 1, md: 2 }}>
              {contributedBoards.map((board) => (
                <BoardSummaryCard
                  key={board.board_id}
                  board={{
                    boardId: board.board_id,
                    periodLabel: board.period_label,
                    periodType: board.period_type,
                    teamName: board.team_name,
                    teamSlug: board.team_slug,
                    sectionSlug: board.section_slug,
                    objectives: [],
                  }}
                  linkedDeploymentCount={board.linked_deployment_count}
                />
              ))}
            </HGrid>
          </VStack>
        )}
        {showAllBoards && contributedBoards.length === 0 && (
          <BodyShort size="small" textColor="subtle">
            Ingen leveranser fra teammedlemmer er koblet til andre teams tavler.
          </BodyShort>
        )}
      </VStack>

      {/* Members */}
      {members.length > 0 && (
        <VStack gap="space-8">
          <Heading level="2" size="small">
            Medlemmer ({members.length})
          </Heading>
          <HStack gap="space-8" wrap>
            {members.map((member) => (
              <Tag key={member.nav_ident} variant="neutral" size="small">
                {member.github_username ? (
                  <Link to={`/users/${member.github_username}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    {member.display_name || member.nav_ident}
                  </Link>
                ) : (
                  member.display_name || member.nav_ident
                )}
              </Tag>
            ))}
          </HStack>
        </VStack>
      )}

      {/* Applications */}
      <VStack gap="space-8">
        <HStack align="center" justify="space-between" wrap>
          <Heading level="2" size="small">
            Applikasjoner ({appCards.length})
          </Heading>
          <Switch
            size="small"
            checked={showAllApps}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams)
              if (e.target.checked) {
                next.set('allApps', 'true')
              } else {
                next.delete('allApps')
              }
              setSearchParams(next)
            }}
          >
            Vis alle apper med teamaktivitet
          </Switch>
        </HStack>
        <Detail textColor="subtle">Statistikk er filtrert til deploys utført av team-medlemmer.</Detail>
        {appCards.length > 0 ? (
          <VStack gap="space-4">
            {appCards.map((app) => (
              <AppCard key={app.id} app={app} appendSearchParams={`team=${encodeURIComponent(devTeam.slug)}`} />
            ))}
          </VStack>
        ) : (
          <BodyShort textColor="subtle">Ingen applikasjoner er lagt til ennå.</BodyShort>
        )}
      </VStack>
    </VStack>
  )
}

function TeamCoverageCards({
  coverage,
  hasMappedMembers,
  unmappedMemberCount,
  totalMembers,
  deploymentsPath,
}: {
  coverage: {
    total: number
    with_four_eyes: number
    four_eyes_percentage: number
    with_origin: number
    origin_percentage: number
    non_member_deployments: number
  }
  hasMappedMembers: boolean
  unmappedMemberCount: number
  totalMembers: number
  deploymentsPath: string
}) {
  if (totalMembers === 0 && coverage.total === 0) {
    return (
      <Alert variant="info">
        Ingen medlemmer er registrert for dette teamet enda. Statistikk på team-medlemmenes deploys vises når medlemmer
        er lagt til.
      </Alert>
    )
  }

  return (
    <VStack gap="space-8">
      {totalMembers === 0 && coverage.total > 0 && (
        <Alert variant="info" size="small">
          Ingen medlemmer er registrert — kun leveranser koblet til måltavlen vises.
        </Alert>
      )}
      {!hasMappedMembers && totalMembers > 0 && coverage.total > 0 && (
        <Alert variant="warning" size="small">
          Ingen av de {totalMembers} medlemmene har et GitHub-brukernavn registrert — kun leveranser koblet til
          måltavlen vises.
        </Alert>
      )}
      {!hasMappedMembers && totalMembers > 0 && coverage.total === 0 && (
        <Alert variant="warning">
          Ingen av de {totalMembers} medlemmene har et GitHub-brukernavn registrert. Statistikk vises når
          brukerkoblinger er på plass.
        </Alert>
      )}
      {hasMappedMembers && unmappedMemberCount > 0 && (
        <Alert variant="warning" size="small">
          {unmappedMemberCount} av {totalMembers} medlemmer mangler GitHub-brukernavn — statistikken kan være
          ufullstendig.
        </Alert>
      )}
      <HGrid gap="space-12" columns={{ xs: 1, sm: 2, md: 4 }}>
        <CoverageCard
          label="Leveranser i år"
          value={coverage.total.toString()}
          href={`${deploymentsPath}?period=ytd`}
        />
        <CoverageCard
          label="4-øyne-dekning"
          value={`${coverage.four_eyes_percentage}%`}
          sub={`${coverage.with_four_eyes} av ${coverage.total}`}
          href={`${deploymentsPath}?period=ytd&status=not_approved`}
        />
        <CoverageCard
          label="Endringsopphav"
          value={`${coverage.origin_percentage}%`}
          sub={`${coverage.with_origin} av ${coverage.total}`}
          href={`${deploymentsPath}?period=ytd&goal=missing`}
        />
        <CoverageCard label="Fra andre" value={coverage.non_member_deployments.toString()} sub="Koblet via måltavle" />
      </HGrid>
      <Detail textColor="subtle">
        {hasMappedMembers
          ? 'Inkluderer leveranser koblet til teamets måltavle og ukoblede leveranser fra teammedlemmer (år til dato).'
          : 'Viser leveranser koblet til teamets måltavle (år til dato).'}
      </Detail>
    </VStack>
  )
}

function CoverageCard({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const content = (
    <VStack gap="space-4">
      <Detail textColor="subtle">{label}</Detail>
      <Heading level="3" size="medium">
        {value}
      </Heading>
      {sub && <Detail textColor="subtle">{sub}</Detail>}
    </VStack>
  )

  if (href) {
    return (
      <LinkCard>
        <LinkCard.Title as="span">
          <LinkCard.Anchor asChild>
            <Link to={href}>{label}</Link>
          </LinkCard.Anchor>
        </LinkCard.Title>
        <LinkCard.Description>
          <VStack gap="space-4">
            <Heading level="3" size="medium" aria-label={`${label}: ${value}`}>
              {value}
            </Heading>
            {sub && <Detail textColor="subtle">{sub}</Detail>}
          </VStack>
        </LinkCard.Description>
      </LinkCard>
    )
  }

  return (
    <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      {content}
    </Box>
  )
}

function ActiveBoardSection({
  board,
  progress,
  teamBasePath,
}: {
  board: Board
  progress: BoardProgressResult | null
  teamBasePath: string
}) {
  const objectives = progress?.objectives ?? []
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <HStack justify="space-between" align="center" wrap>
          <VStack gap="space-4">
            <Heading level="2" size="medium">
              <Link to={`${teamBasePath}/${board.id}`}>{board.period_label}</Link>
            </Heading>
            <HStack gap="space-8" align="center">
              <Tag variant="success" size="xsmall">
                Aktiv
              </Tag>
              <Detail textColor="subtle">
                {new Date(board.period_start).toLocaleDateString('nb-NO', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {' – '}
                {new Date(board.period_end).toLocaleDateString('nb-NO', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Detail>
            </HStack>
          </VStack>
          <Button
            as={Link}
            to={`${teamBasePath}/dashboard?periodType=${board.period_type}&period=${encodeURIComponent(board.period_label)}`}
            variant="tertiary"
            size="small"
            icon={<BarChartIcon aria-hidden />}
          >
            Dashboard
          </Button>
        </HStack>

        {objectives.length > 0 ? (
          <VStack gap="space-8">
            {objectives.map((obj) => (
              <Box key={obj.objective_id} padding="space-12" borderRadius="4" background="neutral-soft">
                <VStack gap="space-4">
                  <HStack justify="space-between" align="center">
                    <BodyShort weight="semibold" size="small">
                      {obj.objective_title}
                    </BodyShort>
                    <Tag variant="neutral" size="xsmall">
                      {obj.total_linked_deployments} deployments
                    </Tag>
                  </HStack>
                  {obj.key_results.length > 0 && (
                    <HStack gap="space-8" wrap>
                      {obj.key_results.map((kr) => (
                        <Detail key={kr.id} textColor="subtle">
                          {kr.title}: {kr.linked_deployments}
                        </Detail>
                      ))}
                    </HStack>
                  )}
                </VStack>
              </Box>
            ))}
          </VStack>
        ) : (
          <BodyShort size="small" textColor="subtle">
            Ingen mål er opprettet for denne tavlen ennå.
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}

/** Floors percentage to avoid showing 100% unless it's truly complete. */
function floorUnlessPerfect(pct: number): number {
  if (pct >= 100) return 100
  return Math.floor(pct)
}
