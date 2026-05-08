import { BodyShort, Box, Heading, VStack } from '@navikt/ds-react'
import { Link, redirect, useLoaderData, useSearchParams } from 'react-router'
import { DeploymentFilters, DeploymentRow, PaginationControls } from '~/components/deployments'
import { pool } from '~/db/connection.server'
import { getLinkedObjectivesForApps } from '~/db/deployment-goal-links.server'
import { type DeploymentFilters as DeploymentFiltersType, getDeploymentsPaginated } from '~/db/deployments.server'
import { getDevTeamApplications, getDevTeamBySlug, getGroupAppIdsForDevTeams } from '~/db/dev-teams.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getMembersGithubUsernamesForDevTeamRoles } from '~/db/role-assignments.server'
import { getUserMappingByNavIdent, getUserMappings } from '~/db/user-mappings.server'
import { getUserIdentity } from '~/lib/auth.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { serializeUserMappings } from '~/lib/user-display'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.deployments'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.devTeam ? `Deployments - ${data.devTeam.name}` : 'Deployments' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
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
  const period = (url.searchParams.get('period') || 'ytd') as TimePeriod
  const appFilter = url.searchParams.get('app') || ''

  const range = getDateRangeForPeriod(period)

  // Resolve team apps
  const [directApps, groupAppIds, allApps, deployerUsernames] = await Promise.all([
    getDevTeamApplications(devTeam.id),
    getGroupAppIdsForDevTeams([devTeam.id]),
    getAllMonitoredApplications(),
    getMembersGithubUsernamesForDevTeamRoles([devTeam.id]).catch(() => [] as string[]),
  ])

  const directAppIds = new Set([...directApps.map((a) => a.monitored_app_id), ...groupAppIds])
  const naisTeamSlugs = devTeam.nais_team_slugs ?? []
  const teamApps = allApps.filter(
    (app) => app.is_active && (directAppIds.has(app.id) || naisTeamSlugs.includes(app.team_slug)),
  )

  if (teamApps.length === 0) {
    return {
      devTeam,
      sectionSlug: params.sectionSlug,
      deployments: [] as Awaited<ReturnType<typeof getDeploymentsPaginated>>['deployments'],
      total: 0,
      page: 1,
      total_pages: 0,
      userMappings: {} as ReturnType<typeof serializeUserMappings>,
      deployerOptions: [] as { value: string; label: string }[],
      currentUserGithub: null as string | null,
      errorReasons: {} as Record<number, string>,
      teamFilterEmptyReason: null as string | null,
      hasUnmappedDeployers: false,
      goalOptions: [] as { id: number; title: string; dev_team_name: string | null; period_label: string | null }[],
      appOptions: [] as { value: string; label: string }[],
    }
  }

  const teamAppIds = teamApps.map((a) => a.id)
  const parsedAppFilter = appFilter ? parseInt(appFilter, 10) : undefined
  const filteredAppIds = parsedAppFilter && teamAppIds.includes(parsedAppFilter) ? [parsedAppFilter] : teamAppIds

  // Resolve current user
  const currentUser = await getUserIdentity(request)

  // Deployer filter: default shows only team members' deployments
  let deployerUsernamesFilter: string[] | undefined = deployerUsernames
  let teamFilterEmptyReason: string | null = null
  if (deployerUsernames.length === 0) {
    teamFilterEmptyReason = 'no-team-members'
  }

  if (deployer) {
    // If a specific deployer is selected, override the team filter
    deployerUsernamesFilter = undefined
  }

  const isUnmappedFilter = deployer === '__unmapped__'
  const isNonMemberFilter = deployer === '__non_member__'

  const filters: DeploymentFiltersType = {
    monitored_app_ids: filteredAppIds,
    per_app_audit_start_year: true,
    page,
    per_page: 20,
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    goal_filter: goal && ['missing', 'linked'].includes(goal) ? goal : undefined,
    goal_objective_id: goalObjectiveId && !Number.isNaN(goalObjectiveId) ? goalObjectiveId : undefined,
    goal_dev_team_id: devTeam.id,
    deployer_username: isUnmappedFilter || isNonMemberFilter ? undefined : deployer,
    unmapped_deployers: isUnmappedFilter || undefined,
    exclude_deployer_usernames: isNonMemberFilter ? deployerUsernames : undefined,
    deployer_usernames: deployer ? undefined : deployerUsernamesFilter,
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

  // Parallel: error reasons, all deployers, current user GitHub mapping, goal options
  const errorDeploymentIds = result.deployments.filter((d) => d.four_eyes_status === 'error').map((d) => d.id)

  const [errorReasonsResult, allDeployersResult, currentUserMapping, goalOptions] = await Promise.all([
    errorDeploymentIds.length > 0
      ? pool.query<{ deployment_id: number; result: any }>(
          `SELECT DISTINCT ON (deployment_id) deployment_id, result
           FROM verification_runs
           WHERE deployment_id = ANY($1)
           ORDER BY deployment_id, run_at DESC`,
          [errorDeploymentIds],
        )
      : Promise.resolve({ rows: [] as { deployment_id: number; result: any }[] }),
    pool.query<{ deployer_username: string }>(
      `SELECT DISTINCT deployer_username FROM deployments
         WHERE monitored_app_id = ANY($1) AND deployer_username IS NOT NULL AND deployer_username != ''`,
      [teamAppIds],
    ),
    currentUser?.navIdent ? getUserMappingByNavIdent(currentUser.navIdent) : Promise.resolve(null),
    getLinkedObjectivesForApps(teamAppIds),
  ])

  const errorReasons: Record<number, string> = Object.fromEntries(
    errorReasonsResult.rows
      .filter((row) => row.result?.approvalDetails?.reason)
      .map((row) => [row.deployment_id, row.result.approvalDetails.reason as string]),
  )

  // Build deployer options with display names
  const allDeployerUsernames = allDeployersResult.rows.map((r) => r.deployer_username)

  // Get display names for deployers, PR creators, and mergers
  const deployerUsernamesOnPage = [
    ...new Set(result.deployments.map((d) => d.deployer_username).filter(Boolean)),
  ] as string[]
  const prCreatorUsernames = result.deployments
    .map((d: any) => d.github_pr_data?.creator?.username)
    .filter(Boolean) as string[]
  const prMergerUsernames = result.deployments
    .map((d: any) => d.github_pr_data?.merged_by?.username)
    .filter(Boolean) as string[]
  const allUsernamesForMapping = [
    ...new Set([...deployerUsernamesOnPage, ...prCreatorUsernames, ...prMergerUsernames, ...allDeployerUsernames]),
  ]
  const userMappingsMap = allUsernamesForMapping.length > 0 ? await getUserMappings(allUsernamesForMapping) : new Map()

  const deployerOptions = allDeployerUsernames
    .map((username) => ({
      value: username,
      label: userMappingsMap.get(username)?.display_name ?? username,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))

  const currentUserGithub = currentUserMapping?.github_username ?? null

  // Check for unmapped deployers
  const hasUnmappedDeployers = allDeployerUsernames.some(
    (u) => !userMappingsMap.has(u) || !userMappingsMap.get(u)?.display_name,
  )

  // Check for non-member deployers (deployers not in the team member list)
  const lowerMembers = new Set(deployerUsernames.map((u) => u.toLowerCase()))
  const hasNonMemberDeployers =
    deployerUsernames.length > 0 && allDeployerUsernames.some((u) => !lowerMembers.has(u.toLowerCase()))

  // App filter options
  const appOptions = teamApps
    .map((a) => ({
      value: String(a.id),
      label: `${a.app_name} (${a.environment_name})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))

  return {
    devTeam,
    sectionSlug: params.sectionSlug,
    deployments: result.deployments,
    total: result.total,
    page: result.page,
    total_pages: result.total_pages,
    userMappings: serializeUserMappings(userMappingsMap),
    deployerOptions,
    currentUserGithub,
    errorReasons,
    teamFilterEmptyReason,
    hasUnmappedDeployers,
    hasNonMemberDeployers,
    goalOptions,
    appOptions,
  }
}

export default function TeamDeployments() {
  const {
    devTeam,
    sectionSlug,
    deployments,
    total,
    page,
    total_pages,
    userMappings,
    deployerOptions,
    currentUserGithub,
    errorReasons,
    teamFilterEmptyReason,
    hasUnmappedDeployers,
    hasNonMemberDeployers,
    goalOptions,
    appOptions,
  } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()

  const currentStatus = searchParams.get('status') || ''
  const currentMethod = searchParams.get('method') || ''
  const currentGoal = searchParams.get('goal') || ''
  const currentDeployer = searchParams.get('deployer') || ''
  const currentSha = searchParams.get('sha') || ''
  const currentPeriod = searchParams.get('period') || 'ytd'
  const currentApp = searchParams.get('app') || ''

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
      <VStack gap="space-8">
        <BodyShort size="small">
          <Link to={`/sections/${sectionSlug}/teams/${devTeam.slug}`}>{devTeam.name}</Link>
        </BodyShort>
        <Heading level="1" size="large">
          Deployments
        </Heading>
      </VStack>

      <DeploymentFilters
        currentPeriod={currentPeriod}
        currentStatus={currentStatus}
        currentMethod={currentMethod}
        currentGoal={currentGoal}
        currentDeployer={currentDeployer}
        currentSha={currentSha}
        currentTeam=""
        currentApp={currentApp}
        deployerOptions={deployerOptions}
        teamOptions={[]}
        goalOptions={goalOptions}
        appOptions={appOptions}
        hasUnmappedDeployers={hasUnmappedDeployers}
        hasNonMemberDeployers={hasNonMemberDeployers}
        currentUserGithub={currentUserGithub}
        onFilterChange={updateFilter}
      />

      <BodyShort textColor="subtle">
        {total} deployment{total !== 1 ? 's' : ''} funnet
      </BodyShort>

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
              showApp
              searchParams={searchParams}
            />
          ))
        )}
      </div>

      <PaginationControls page={page} totalPages={total_pages} onPageChange={goToPage} />
    </VStack>
  )
}
