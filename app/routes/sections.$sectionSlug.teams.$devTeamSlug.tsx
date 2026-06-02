import { CogIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Button, Detail, Heading, HGrid, HStack, Switch, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData, useSearchParams } from 'react-router'
import { ActiveBoardSection } from '~/components/ActiveBoardSection'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { BoardSummaryCard } from '~/components/BoardSummaryCard'
import { TeamCoverageCards } from '~/components/DevTeamCoverageCards'
import { getAppIdsByGroupIds, getGroupNamesByIds } from '~/db/application-groups.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getBoardsByDevTeam } from '~/db/boards.server'
import { getBoardObjectiveProgress, getContributedBoards, getDevTeamStats } from '~/db/dashboard-stats.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import {
  getDevTeamApplications,
  getDevTeamBySlug,
  getExclusivelyOwnedAppIds,
  getGroupAppIdsForDevTeams,
} from '~/db/dev-teams.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '~/db/monitored-applications.server'
import {
  type DevTeamMemberWithRole,
  getDevTeamMembersWithRoles,
  getMembersGithubUsernamesForDevTeamRoles,
} from '~/db/role-assignments.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { canAccessTeamAdmin } from '~/lib/authorization.server'
import { groupAppCards } from '~/lib/group-app-cards'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }
  const [
    boards,
    members,
    directApps,
    groupAppIds,
    allApps,
    alertCounts,
    activeRepos,
    deployerUsernames,
    canAccessAdmin,
  ] = await Promise.all([
    getBoardsByDevTeam(devTeam.id),
    getDevTeamMembersWithRoles(devTeam.id).catch(() => [] as DevTeamMemberWithRole[]),
    getDevTeamApplications(devTeam.id),
    getGroupAppIdsForDevTeams([devTeam.id]),
    getAllMonitoredApplications(),
    getAllAlertCounts(),
    getAllActiveRepositories(),
    getMembersGithubUsernamesForDevTeamRoles([devTeam.id]).catch(() => [] as string[]),
    canAccessTeamAdmin(user, devTeam.id),
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

  // Determine which apps are exclusively owned by this team (no other team claims them).
  // For those apps, show all deployments unfiltered — avoids misleading "Ingen data" when
  // an app is deployed by people not yet added as team members.
  const hasMappedMembers = members.some((m) => Boolean(m.github_username))
  const exclusiveAppIds =
    appsForStats.length > 0
      ? await getExclusivelyOwnedAppIds(
          devTeam.id,
          appsForStats.map((a) => a.id),
        )
      : new Set<number>()

  // For grouped apps, all siblings (across all teams) must be exclusive for the
  // group to be unfiltered. When AppCard uses group=true, the link expands to all
  // siblings — so we must check the full group, not just this team's subset.
  const effectiveExclusiveIds = new Set(exclusiveAppIds)
  const groupIdsInView = [
    ...new Set(appsForStats.map((a) => a.application_group_id).filter((id): id is number => id != null)),
  ]
  if (groupIdsInView.length > 0) {
    const allSiblingsByGroup = await getAppIdsByGroupIds(groupIdsInView)
    for (const [, siblingIds] of allSiblingsByGroup) {
      const allExclusive = siblingIds.every((id) => exclusiveAppIds.has(id))
      if (!allExclusive) {
        for (const id of siblingIds) {
          effectiveExclusiveIds.delete(id)
        }
      }
    }
  }

  const exclusiveApps = appsForStats.filter((a) => effectiveExclusiveIds.has(a.id))
  const sharedApps = appsForStats.filter((a) => !effectiveExclusiveIds.has(a.id))

  const statsOptions = { startDate: ytdStart }
  const [exclusiveStats, sharedStats] = await Promise.all([
    exclusiveApps.length > 0
      ? getAppDeploymentStatsBatch(
          exclusiveApps.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })),
          undefined,
          statsOptions,
        )
      : Promise.resolve(new Map()),
    sharedApps.length > 0
      ? getAppDeploymentStatsBatch(
          sharedApps.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })),
          deployerUsernames,
          statsOptions,
        )
      : Promise.resolve(new Map()),
  ])

  const statsByApp = new Map([...exclusiveStats, ...sharedStats])

  // Derive top-card stats from the board-based team stats function.
  // This guarantees consistency with the section page (same counting logic).
  // Note: top-level total counts board-linked deploys (any deployer) + unlinked deploys
  // by team members. Per-app stats may differ for exclusively-owned apps where all
  // deployments are shown unfiltered (app-level governance view vs team performance view).
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

  // Determine which cards show unfiltered stats. Since effectiveExclusiveIds already
  // downgrades mixed groups, we can check the card's primary ID directly.
  // For grouped cards, all members share the same group fate (all exclusive or all shared).
  const unfilteredCardIds = new Set(
    appCards.filter((card) => effectiveExclusiveIds.has(card.id)).map((card) => card.id),
  )

  const section = await getSectionBySlug(params.sectionSlug)

  // Deduplicate members by nav_ident (a user may have multiple roles)
  const uniqueMembers = Array.from(new Map(members.map((m) => [m.nav_ident.toUpperCase(), m])).values())

  return {
    devTeam,
    activeBoard,
    activeBoardProgress,
    contributedBoards,
    members: uniqueMembers.map(({ nav_ident, display_name, github_username }) => ({
      nav_ident,
      display_name,
      github_username,
    })),
    appCards,
    unfilteredCardIds: [...unfilteredCardIds],
    showAllApps,
    showAllBoards,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
    teamCoverage,
    hasMappedMembers,
    unmappedMemberCount: uniqueMembers.filter((m) => !m.github_username).length,
    canAccessAdmin,
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
    unfilteredCardIds,
    showAllApps,
    showAllBoards,
    sectionSlug,
    teamCoverage,
    hasMappedMembers,
    unmappedMemberCount,
    canAccessAdmin,
  } = useLoaderData<typeof loader>()
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`
  const [searchParams, setSearchParams] = useSearchParams()
  const unfilteredSet = new Set(unfilteredCardIds)

  return (
    <VStack gap="space-24">
      <div>
        <HStack align="center" justify="space-between">
          <Heading level="1" size="large">
            {devTeam.name}
          </Heading>
          {canAccessAdmin && (
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
          <ActiveBoardSection
            board={activeBoard}
            objectives={activeBoardProgress?.objectives ?? []}
            teamBasePath={teamBasePath}
            headingLevel="2"
          />
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
        <Detail textColor="subtle">
          {unfilteredSet.size > 0
            ? 'Apper eid av kun dette teamet viser alle leveranser. Delte apper er filtrert til teammedlemmer.'
            : 'Statistikk er filtrert til deploys utført av team-medlemmer.'}
        </Detail>
        {appCards.length > 0 ? (
          <VStack gap="space-4">
            {appCards.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                appendSearchParams={unfilteredSet.has(app.id) ? undefined : `team=${encodeURIComponent(devTeam.slug)}`}
              />
            ))}
          </VStack>
        ) : (
          <BodyShort textColor="subtle">Ingen applikasjoner er lagt til ennå.</BodyShort>
        )}
      </VStack>
    </VStack>
  )
}

/** Floors percentage to avoid showing 100% unless it's truly complete. */
function floorUnlessPerfect(pct: number): number {
  if (pct >= 100) return 100
  return Math.floor(pct)
}
