import { BodyShort, Box, Button, HStack, VStack } from '@navikt/ds-react'
import { Link, redirect, useLoaderData, useSearchParams } from 'react-router'
import { DeploymentFilters, DeploymentRow, PaginationControls } from '~/components/deployments'
import { getGroupContext } from '~/db/application-groups.server'
import { pool } from '~/db/connection.server'
import { getLinkedObjectivesForApps } from '~/db/deployment-goal-links.server'
import { type DeploymentFilters as DeploymentFiltersType, getDeploymentsPaginated } from '~/db/deployments.server'
import { getDevTeamBySlug, getDevTeamsForApp, getDevTeamsForApps } from '~/db/dev-teams.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import {
  getDevTeamsForGithubUsernamesByRole,
  getMembersGithubUsernamesForDevTeamRoles,
  getUserDevTeamsByRole,
} from '~/db/role-assignments.server'
import { getGithubUserLookups, getUserByIdentifier } from '~/db/user-github-lookups.server'
import { getUserIdentity } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { serializeUserLookups } from '~/lib/user-display'
import type { Route } from './+types/$team.env.$env.app.$app.deployments'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Deployments - ${data.app.app_name}` : 'Deployments' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { team, env, app: appName } = requireTeamEnvAppParams(params)

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const goalParam = url.searchParams.get('goal') || ''
  const goal: 'missing' | 'linked' | undefined =
    goalParam === 'missing' || goalParam === 'linked' ? goalParam : undefined
  const goalObjectiveId = goalParam.startsWith('obj:') ? parseInt(goalParam.slice(4), 10) : undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod
  const showGroup = url.searchParams.get('group') === 'true'
  const teamFilter = url.searchParams.get('team') || ''

  const range = getDateRangeForPeriod(period)

  // Check if this app belongs to an application group
  const { group: appGroup, siblings: allSiblings } = await getGroupContext(app.id)
  const hasGroup = allSiblings.length > 0
  const siblings = showGroup ? allSiblings : []

  // Resolve current user (used for "Meg" deployer shortcut and "Mine team" filter)
  const currentUser = await getUserIdentity(request)

  // Dev teams owning this app (or group siblings) — used to populate the team-filter dropdown.
  // When viewing a group, check ownership across ALL sibling apps so a dev team
  // that only owns a secondary app in the group is still found.
  const owningDevTeams =
    showGroup && hasGroup
      ? await getDevTeamsForApps([
          { monitoredAppId: app.id, teamSlug: app.team_slug },
          ...allSiblings.map((s) => ({ monitoredAppId: s.id, teamSlug: s.team_slug })),
        ])
      : await getDevTeamsForApp(app.id, app.team_slug)

  // User's assigned dev teams — needed both to render the "Mine team" option
  // (only shown when the user has a role in at least one team) and to resolve
  // it to a list of GitHub usernames when applied.
  let userDevTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> | null = null
  if (currentUser?.navIdent) {
    try {
      userDevTeams = await getUserDevTeamsByRole(currentUser.navIdent)
    } catch {
      // Graceful degradation if role assignments query fails
    }
  }

  // Resolve the team filter to a list of GitHub usernames.
  // - "" / "all"  → no filter (undefined)
  // - "mine"      → union of all members across the user's dev teams
  // - "<slug>"    → members of that single dev team (owner or contributor)
  //
  // We track *why* the resolved set is empty so the UI can give a useful
  // empty-state hint instead of generic "no deployments". `teamFilterEmpty`
  // is true only when the filter was applied but yields no candidate users.
  let deployerUsernamesFilter: string[] | undefined
  let teamFilterEmptyReason: 'no-user-teams' | 'no-team-members' | null = null
  // Wrap helper calls in try/catch so the page still works if the
  // dev_team_role_assignments table hasn't been deployed yet (matches the
  // graceful degradation for getUserDevTeamsByRole above) — fall back to no filter.
  if (teamFilter === 'mine') {
    if (userDevTeams === null) {
      // Role query failed — fall back to no filter rather than showing 0 deployments
      deployerUsernamesFilter = undefined
    } else if (userDevTeams.length === 0) {
      deployerUsernamesFilter = []
      teamFilterEmptyReason = 'no-user-teams'
    } else {
      try {
        deployerUsernamesFilter = await getMembersGithubUsernamesForDevTeamRoles(userDevTeams.map((t) => t.id))
        if (deployerUsernamesFilter.length === 0) teamFilterEmptyReason = 'no-team-members'
      } catch {
        deployerUsernamesFilter = undefined
      }
    }
  } else if (teamFilter) {
    // Look up the team by slug — it may be an owning team or a contributing team
    const matched = owningDevTeams.find((t) => t.slug === teamFilter) ?? (await getDevTeamBySlug(teamFilter))
    if (matched) {
      try {
        deployerUsernamesFilter = await getMembersGithubUsernamesForDevTeamRoles([matched.id])
        if (deployerUsernamesFilter.length === 0) teamFilterEmptyReason = 'no-team-members'
      } catch {
        deployerUsernamesFilter = undefined
      }
    }
    // If the slug doesn't match any known team, silently ignore (treat as "Alle")
  }

  const isUnmappedFilter = deployer === '__unmapped__'

  const filters: DeploymentFiltersType = {
    ...(showGroup && hasGroup
      ? { monitored_app_ids: [app.id, ...siblings.map((s) => s.id)], per_app_audit_start_year: true }
      : { monitored_app_id: app.id, audit_start_year: app.audit_start_year }),
    page,
    per_page: 20,
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    goal_filter: goal && ['missing', 'linked'].includes(goal) ? goal : undefined,
    goal_objective_id: goalObjectiveId && !Number.isNaN(goalObjectiveId) ? goalObjectiveId : undefined,
    deployer_username: isUnmappedFilter ? undefined : deployer,
    unmapped_deployers: isUnmappedFilter || undefined,
    deployer_usernames: deployerUsernamesFilter,
    commit_sha: sha,
    start_date: range?.startDate,
    end_date: range?.endDate,
  }

  const result = await getDeploymentsPaginated(filters)

  // Redirect to last valid page if requested page exceeds total pages
  if (page > result.total_pages && result.total_pages > 0) {
    url.searchParams.set('page', String(result.total_pages))
    throw redirect(url.pathname + url.search)
  }

  // ── Parallel: error reasons, all deployers, and current user GitHub mapping ──
  const errorDeploymentIds = result.deployments.filter((d) => d.four_eyes_status === 'error').map((d) => d.id)
  const appIds = showGroup && hasGroup ? [app.id, ...siblings.map((s) => s.id)] : [app.id]

  const [errorReasonsResult, allDeployersResult, allContributorsResult, currentUserMapping, goalOptions] =
    await Promise.all([
      errorDeploymentIds.length > 0
        ? pool.query(
            `SELECT DISTINCT ON (deployment_id) deployment_id, result
           FROM verification_runs
           WHERE deployment_id = ANY($1)
           ORDER BY deployment_id, run_at DESC`,
            [errorDeploymentIds],
          )
        : Promise.resolve({ rows: [] as any[] }),
      pool.query(
        `SELECT DISTINCT d.deployer_username
       FROM deployments d
       INNER JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.monitored_app_id = ANY($1)
         AND d.deployer_username IS NOT NULL
         AND d.deployer_username != ''
         AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
       ORDER BY d.deployer_username`,
        [appIds],
      ),
      pool.query(
        `SELECT username FROM (
         SELECT d.deployer_username AS username
         FROM deployments d
         INNER JOIN monitored_applications ma ON d.monitored_app_id = ma.id
         WHERE d.monitored_app_id = ANY($1)
           AND d.deployer_username IS NOT NULL AND d.deployer_username != ''
           AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
         UNION
         SELECT d.pr_creator_username
         FROM deployments d
         INNER JOIN monitored_applications ma ON d.monitored_app_id = ma.id
         WHERE d.monitored_app_id = ANY($1)
           AND d.pr_creator_username IS NOT NULL
           AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
         UNION
         SELECT d.github_pr_data->'merged_by'->>'username'
         FROM deployments d
         INNER JOIN monitored_applications ma ON d.monitored_app_id = ma.id
         WHERE d.monitored_app_id = ANY($1)
           AND d.github_pr_data->'merged_by'->>'username' IS NOT NULL
           AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
       ) sub
       WHERE username IS NOT NULL AND username != ''`,
        [appIds],
      ),
      currentUser?.navIdent ? getUserByIdentifier(currentUser.navIdent) : Promise.resolve(null),
      getLinkedObjectivesForApps(appIds),
    ])

  const errorReasons: Record<number, string> = Object.fromEntries(
    errorReasonsResult.rows
      .filter((row: any) => row.result?.approvalDetails?.reason)
      .map((row: any) => [row.deployment_id, row.result.approvalDetails.reason as string]),
  )

  const allDeployers = allDeployersResult.rows.map((r: any) => r.deployer_username as string)

  // Get display names for deployers, PR creators, and mergers (current page + all distinct deployers for filter)
  const deployerUsernames = [...new Set(result.deployments.map((d) => d.deployer_username).filter(Boolean))] as string[]
  const prCreatorUsernames = result.deployments
    .map((d: any) => d.github_pr_data?.creator?.username)
    .filter(Boolean) as string[]
  const prMergerUsernames = result.deployments
    .map((d: any) => d.github_pr_data?.merged_by?.username)
    .filter(Boolean) as string[]
  const allUsernamesForMapping = [
    ...new Set([...deployerUsernames, ...prCreatorUsernames, ...prMergerUsernames, ...allDeployers]),
  ]
  const userMappings = await getGithubUserLookups(allUsernamesForMapping)

  // Build deployer options with display names
  const deployerOptions = allDeployers.map((username) => {
    const mapping = userMappings.get(username)
    return { value: username, label: mapping?.display_name || username }
  })
  deployerOptions.sort((a, b) => a.label.localeCompare(b.label, 'no'))

  // Check if any deployer in the audit window lacks an active mapping
  const hasUnmappedDeployers = allDeployers.some((u) => {
    const m = userMappings.get(u)
    return !m || m.account_deleted_at !== null
  })

  // Find current user's GitHub username for "Meg" shortcut
  let currentUserGithub: string | null = null
  if (currentUserMapping?.github_username && allDeployers.includes(currentUserMapping.github_username)) {
    currentUserGithub = currentUserMapping.github_username
  }

  // Build dropdown options for the team filter:
  // 1. "Mine team" (if user has assigned dev-team roles)
  // 2. Teams owning the app + teams with contributing members (deployer/PR creator/merger)
  const allContributors = [...new Set(allContributorsResult.rows.map((r: any) => r.username as string))]
  let contributingTeams: Array<{ id: number; slug: string; name: string }> = []
  try {
    contributingTeams = await getDevTeamsForGithubUsernamesByRole(allContributors)
  } catch (error) {
    logger.warn('Failed to fetch contributing teams for deployment list', { error })
  }

  const teamOptions: { value: string; label: string }[] = []
  if (userDevTeams && userDevTeams.length > 0) {
    teamOptions.push({ value: 'mine', label: 'Mine team' })
  }
  const seenSlugs = new Set<string>()
  const allTeams = [...owningDevTeams, ...contributingTeams]
  allTeams.sort((a, b) => a.name.localeCompare(b.name, 'no'))
  for (const t of allTeams) {
    if (seenSlugs.has(t.slug)) continue
    seenSlugs.add(t.slug)
    teamOptions.push({ value: t.slug, label: t.name })
  }

  return {
    app,
    userMappings: serializeUserLookups(userMappings),
    deployerOptions,
    currentUserGithub,
    hasGroup,
    showGroup: showGroup && hasGroup,
    appGroup,
    groupSiblings: allSiblings,
    errorReasons,
    teamOptions,
    teamFilterEmptyReason,
    hasUnmappedDeployers,
    goalOptions,
    ...result,
  }
}

export default function AppDeployments() {
  const {
    app,
    deployments,
    total,
    page,
    total_pages,
    userMappings,
    deployerOptions,
    currentUserGithub,
    hasGroup,
    showGroup,
    appGroup,
    groupSiblings,
    errorReasons,
    teamOptions,
    teamFilterEmptyReason,
    hasUnmappedDeployers,
    goalOptions,
  } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()

  const currentStatus = searchParams.get('status') || ''
  const currentMethod = searchParams.get('method') || ''
  const currentGoal = searchParams.get('goal') || ''
  const currentDeployer = searchParams.get('deployer') || ''
  const currentSha = searchParams.get('sha') || ''
  const currentPeriod = searchParams.get('period') || 'last-week'
  const teamParam = searchParams.get('team') || ''
  // Clear 'mine' if the option isn't available (e.g. role query failed)
  const currentTeam = teamParam === 'mine' && !teamOptions.some((o) => o.value === 'mine') ? '' : teamParam

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  const goToPage = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', String(newPage))
    setSearchParams(newParams)
  }

  return (
    <VStack gap="space-32">
      {/* Group info banner */}
      {appGroup && !showGroup && (
        <Box padding="space-16" borderRadius="8" background="neutral-soft">
          <HStack gap="space-8" align="center" justify="space-between" wrap>
            <BodyShort size="small">
              Denne appen er del av gruppen <strong>{appGroup.name}</strong>
              {groupSiblings.length > 0 && (
                <>
                  {' — '}
                  {groupSiblings.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ', '}
                      <Link to={`/team/${s.team_slug}/env/${s.environment_name}/app/${s.app_name}/deployments`}>
                        {s.app_name} ({s.environment_name})
                      </Link>
                    </span>
                  ))}
                </>
              )}
            </BodyShort>
            {hasGroup && (
              <Button variant="tertiary" size="xsmall" onClick={() => updateFilter('group', 'true')}>
                Vis alle miljøer
              </Button>
            )}
          </HStack>
        </Box>
      )}

      <DeploymentFilters
        currentPeriod={currentPeriod}
        currentStatus={currentStatus}
        currentMethod={currentMethod}
        currentGoal={currentGoal}
        currentDeployer={currentDeployer}
        currentSha={currentSha}
        currentTeam={currentTeam}
        deployerOptions={deployerOptions}
        teamOptions={teamOptions}
        goalOptions={goalOptions}
        hasUnmappedDeployers={hasUnmappedDeployers}
        currentUserGithub={currentUserGithub}
        onFilterChange={updateFilter}
      />

      <HStack justify="space-between" align="center" wrap>
        <BodyShort textColor="subtle">
          {total} deployment{total !== 1 ? 's' : ''} funnet
          {showGroup && ' (alle miljøer)'}
        </BodyShort>
        {hasGroup && (
          <Button
            variant={showGroup ? 'secondary' : 'tertiary'}
            size="small"
            onClick={() => updateFilter('group', showGroup ? '' : 'true')}
          >
            {showGroup ? 'Vis kun dette miljøet' : 'Vis alle miljøer'}
          </Button>
        )}
      </HStack>

      {/* Deployments list */}
      <div>
        {deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>
              {teamFilterEmptyReason === 'no-user-teams'
                ? 'Du har ikke valgt noen utviklingsteam under dine preferanser, så «Mine team» gir ingen treff.'
                : teamFilterEmptyReason === 'no-team-members'
                  ? 'Det valgte teamet har ingen medlemmer med GitHub-brukernavn registrert, så filteret gir ingen treff.'
                  : 'Ingen deployments funnet med valgte filtre.'}
            </BodyShort>
          </Box>
        ) : (
          deployments.map((deployment) => (
            <DeploymentRow
              key={deployment.id}
              deployment={deployment}
              userMappings={userMappings}
              errorReason={errorReasons[deployment.id]}
              showEnv={showGroup}
              currentEnv={app.environment_name}
              searchParams={searchParams}
            />
          ))
        )}
      </div>

      <PaginationControls page={page} totalPages={total_pages} onPageChange={goToPage} />
    </VStack>
  )
}
