import { BodyShort, Box, Heading, VStack } from '@navikt/ds-react'
import { Link, redirect, useLoaderData, useSearchParams } from 'react-router'
import { DeploymentFilters, DeploymentRow, PaginationControls } from '~/components/deployments'
import { pool } from '~/db/connection.server'
import { getFallbackGoalOption, getLinkedGoalsForApps } from '~/db/deployment-goal-links.server'
import { type DeploymentFilters as DeploymentFiltersType, getDeploymentsPaginated } from '~/db/deployments.server'
import { getDevTeamApplications, getDevTeamBySlug, getGroupAppIdsForDevTeams } from '~/db/dev-teams.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getMembersGithubUsernamesForDevTeamRoles } from '~/db/role-assignments.server'
import { getActiveGithubAccountByNavIdent, getGithubUserLookups } from '~/db/user-github-lookups.server'
import { getUserIdentity } from '~/lib/auth.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { serializeUserLookups } from '~/lib/user-display'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.deployments'

export function meta({ loaderData: data }: Route.MetaArgs) {
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
  const goalKeyResultId = goalParam.startsWith('kr:') ? parseInt(goalParam.slice(3), 10) : undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const period = (url.searchParams.get('period') || 'year-to-date') as TimePeriod
  const appFilter = url.searchParams.get('app') || ''

  const range = getDateRangeForPeriod(period)

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
      userMappings: {} as ReturnType<typeof serializeUserLookups>,
      deployerOptions: [] as { value: string; label: string }[],
      currentUserGithub: null as string | null,
      errorReasons: {} as Record<number, string>,
      teamFilterEmptyReason: null as string | null,
      hasUnmappedDeployers: false,
      goalOptions: [] as Awaited<ReturnType<typeof getLinkedGoalsForApps>>,
      appOptions: [] as { value: string; label: string }[],
    }
  }

  const teamAppIds = teamApps.map((a) => a.id)
  const parsedAppFilter = appFilter ? parseInt(appFilter, 10) : undefined
  const filteredAppIds = parsedAppFilter && teamAppIds.includes(parsedAppFilter) ? [parsedAppFilter] : teamAppIds

  const goalObjectiveIdFilter =
    goalObjectiveId !== undefined && Number.isInteger(goalObjectiveId) && goalObjectiveId >= 1
      ? goalObjectiveId
      : undefined
  const goalKeyResultIdFilter =
    goalKeyResultId !== undefined && Number.isInteger(goalKeyResultId) && goalKeyResultId >= 1
      ? goalKeyResultId
      : undefined
  const isGoalSpecificFilter = goalObjectiveIdFilter !== undefined || goalKeyResultIdFilter !== undefined

  if (
    (goalParam.startsWith('obj:') && goalObjectiveIdFilter === undefined) ||
    (goalParam.startsWith('kr:') && goalKeyResultIdFilter === undefined)
  ) {
    const cleanUrl = new URL(request.url)
    cleanUrl.searchParams.delete('goal')
    cleanUrl.searchParams.set('page', '1')
    throw redirect(cleanUrl.pathname + cleanUrl.search)
  }

  const currentUser = await getUserIdentity(request)

  let deployerUsernamesFilter: string[] | undefined = deployerUsernames
  let teamFilterEmptyReason: string | null = null
  if (deployerUsernames.length === 0 && !isGoalSpecificFilter) {
    teamFilterEmptyReason = 'no-team-members'
  }

  if (deployer || isGoalSpecificFilter) {
    deployerUsernamesFilter = undefined
  }

  const isUnmappedFilter = deployer === '__unmapped__'
  const isNonMemberFilter = deployer === '__non_member__'

  const filters: DeploymentFiltersType = {
    monitored_app_ids: isGoalSpecificFilter
      ? parsedAppFilter && teamAppIds.includes(parsedAppFilter)
        ? [parsedAppFilter]
        : undefined
      : filteredAppIds,
    per_app_audit_start_year: isGoalSpecificFilter ? undefined : true,
    page,
    per_page: 20,
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    goal_filter: goal && ['missing', 'linked'].includes(goal) ? goal : undefined,
    goal_objective_id: goalObjectiveIdFilter,
    goal_key_result_id: goalKeyResultIdFilter,
    goal_dev_team_id: isNonMemberFilter && goal === 'linked' ? devTeam.id : undefined,
    deployer_username: isUnmappedFilter || isNonMemberFilter ? undefined : deployer,
    unmapped_deployers: isUnmappedFilter || undefined,
    exclude_deployer_usernames: isNonMemberFilter ? deployerUsernames : undefined,
    deployer_usernames: deployer ? undefined : deployerUsernamesFilter,
    commit_sha: sha,
    start_date: range?.startDate,
    end_date: range?.endDate,
  }

  const result = await getDeploymentsPaginated(filters)

  if (page > result.total_pages && result.total_pages > 0) {
    url.searchParams.set('page', String(result.total_pages))
    throw redirect(url.pathname + url.search)
  }

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
    isGoalSpecificFilter
      ? pool.query<{ deployer_username: string }>(
          `SELECT DISTINCT d.deployer_username
           FROM deployment_goal_links dgl
           JOIN deployments d ON d.id = dgl.deployment_id
           LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
           WHERE dgl.is_active = true
             AND (
               ($1::int IS NOT NULL AND (dgl.objective_id = $1 OR bkr.objective_id = $1))
               OR ($2::int IS NOT NULL AND dgl.key_result_id = $2)
             )
             AND d.deployer_username IS NOT NULL AND d.deployer_username != ''`,
          [goalObjectiveIdFilter ?? null, goalKeyResultIdFilter ?? null],
        )
      : pool.query<{ deployer_username: string }>(
          `SELECT DISTINCT deployer_username FROM deployments
             WHERE monitored_app_id = ANY($1) AND deployer_username IS NOT NULL AND deployer_username != ''`,
          [teamAppIds],
        ),
    currentUser?.navIdent ? getActiveGithubAccountByNavIdent(currentUser.navIdent) : Promise.resolve(null),
    getLinkedGoalsForApps(teamAppIds),
  ])

  const selectedInGoalOptions =
    goalObjectiveIdFilter !== undefined
      ? goalOptions.some((o) => o.type === 'objective' && o.id === goalObjectiveIdFilter)
      : goalKeyResultIdFilter !== undefined
        ? goalOptions.some((o) => o.type === 'key_result' && o.id === goalKeyResultIdFilter)
        : true
  let resolvedGoalOptions = goalOptions
  if (isGoalSpecificFilter && !selectedInGoalOptions) {
    const fallback = await getFallbackGoalOption(goalObjectiveIdFilter, goalKeyResultIdFilter)
    if (fallback === null) {
      const cleanUrl = new URL(request.url)
      cleanUrl.searchParams.delete('goal')
      cleanUrl.searchParams.set('page', '1')
      throw redirect(cleanUrl.pathname + cleanUrl.search)
    }
    resolvedGoalOptions = [...goalOptions, fallback]
  }

  const errorReasons: Record<number, string> = Object.fromEntries(
    errorReasonsResult.rows
      .filter((row) => row.result?.approvalDetails?.reason)
      .map((row) => [row.deployment_id, row.result.approvalDetails.reason as string]),
  )

  const allDeployerUsernames = allDeployersResult.rows.map((r) => r.deployer_username)

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
  const userMappingsMap =
    allUsernamesForMapping.length > 0 ? await getGithubUserLookups(allUsernamesForMapping) : new Map()

  const deployerOptions = allDeployerUsernames
    .map((username) => ({
      value: username,
      label: userMappingsMap.get(username)?.display_name ?? username,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))

  const currentUserGithub = currentUserMapping?.github_username ?? null

  const hasUnmappedDeployers = allDeployerUsernames.some((u) => {
    const m = userMappingsMap.get(u)
    return !m || m.account_deleted_at !== null
  })

  const lowerMembers = new Set(deployerUsernames.map((u) => u.toLowerCase()))
  const hasNonMemberDeployers =
    !isGoalSpecificFilter &&
    deployerUsernames.length > 0 &&
    allDeployerUsernames.some((u) => !lowerMembers.has(u.toLowerCase()))

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
    userMappings: serializeUserLookups(userMappingsMap),
    deployerOptions,
    currentUserGithub,
    errorReasons,
    teamFilterEmptyReason,
    hasUnmappedDeployers,
    hasNonMemberDeployers,
    goalOptions: resolvedGoalOptions,
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
  const currentPeriod = searchParams.get('period') || 'year-to-date'
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
