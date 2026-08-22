import { redirect, useLoaderData } from 'react-router'
import { AppDeploymentsPage } from '~/components/AppDeploymentsPage'
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
import { getWorkflowTriggerLabel } from '~/lib/workflow-trigger-label'
import type { Route } from './+types/$team.env.$env.app.$app.deployments'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Deployments - ${data.app.app_name}` : 'Deployments' }]
}

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { team, env, app: appName } = requireTeamEnvAppParams(params)

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const goalParam = url.searchParams.get('goal') || ''
  const goal: 'missing' | 'linked' | undefined =
    goalParam === 'missing' || goalParam === 'linked' ? goalParam : undefined
  const goalObjectiveId = goalParam.startsWith('obj:') ? parseInt(goalParam.slice(4), 10) : undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const triggerEvent = url.searchParams.get('trigger') || undefined
  const workflowPath = url.searchParams.get('workflowFile') || undefined
  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod
  const showGroup = url.searchParams.get('group') === 'true'
  const teamFilter = url.searchParams.get('team') || ''

  const range = getDateRangeForPeriod(period)

  const { group: appGroup, siblings: allSiblings } = await getGroupContext(app.id)
  const hasGroup = allSiblings.length > 0
  const siblings = showGroup ? allSiblings : []

  const currentUser = await getUserIdentity(request)

  const owningDevTeams =
    showGroup && hasGroup
      ? await getDevTeamsForApps([
          { monitoredAppId: app.id, teamSlug: app.team_slug },
          ...allSiblings.map((s) => ({ monitoredAppId: s.id, teamSlug: s.team_slug })),
        ])
      : await getDevTeamsForApp(app.id, app.team_slug)

  let userDevTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> | null = null
  if (currentUser?.navIdent) {
    try {
      userDevTeams = await getUserDevTeamsByRole(currentUser.navIdent)
    } catch {
      // Graceful degradation if role assignments query fails
    }
  }

  let deployerUsernamesFilter: string[] | undefined
  let teamFilterEmptyReason: 'no-user-teams' | 'no-team-members' | null = null
  if (teamFilter === 'mine') {
    if (userDevTeams === null) {
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
    workflow_trigger_event: triggerEvent,
    workflow_path: workflowPath,
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

  if (page > result.total_pages && result.total_pages > 0) {
    url.searchParams.set('page', String(result.total_pages))
    throw redirect(url.pathname + url.search)
  }

  const errorDeploymentIds = result.deployments.filter((d) => d.four_eyes_status === 'error').map((d) => d.id)
  const appIds = showGroup && hasGroup ? [app.id, ...siblings.map((s) => s.id)] : [app.id]

  const [
    errorReasonsResult,
    allDeployersResult,
    allContributorsResult,
    currentUserMapping,
    goalOptions,
    workflowTriggerOptionsResult,
  ] = await Promise.all([
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
    pool.query(
      `SELECT DISTINCT
           d.workflow_trigger_config ->> 'triggerEvent' AS trigger_event,
           d.workflow_trigger_config ->> 'workflowPath' AS workflow_path
       FROM deployments d
       INNER JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.monitored_app_id = ANY($1)
         AND d.workflow_trigger_config IS NOT NULL
         AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))`,
      [appIds],
    ),
  ])

  const errorReasons: Record<number, string> = Object.fromEntries(
    errorReasonsResult.rows
      .filter((row: any) => row.result?.approvalDetails?.reason)
      .map((row: any) => [row.deployment_id, row.result.approvalDetails.reason as string]),
  )

  const allDeployers = allDeployersResult.rows.map((r: any) => r.deployer_username as string)

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

  const deployerOptions = allDeployers.map((username) => {
    const mapping = userMappings.get(username)
    return { value: username, label: mapping?.display_name || username }
  })
  deployerOptions.sort((a, b) => a.label.localeCompare(b.label, 'no'))

  const hasUnmappedDeployers = allDeployers.some((u) => {
    const m = userMappings.get(u)
    return !m || m.account_deleted_at !== null
  })

  let currentUserGithub: string | null = null
  if (currentUserMapping?.github_username && allDeployers.includes(currentUserMapping.github_username)) {
    currentUserGithub = currentUserMapping.github_username
  }

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

  const triggerEventOptions = [
    ...new Set(
      workflowTriggerOptionsResult.rows.map((r: any) => r.trigger_event as string | null).filter(Boolean) as string[],
    ),
  ]
    .map((value) => ({ value, label: getWorkflowTriggerLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))

  const workflowFileOptions = [
    ...new Set(
      workflowTriggerOptionsResult.rows.map((r: any) => r.workflow_path as string | null).filter(Boolean) as string[],
    ),
  ]
    .map((value) => ({ value, label: value.split('/').pop() ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))

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
    triggerEventOptions,
    workflowFileOptions,
    ...result,
  }
}

export default function AppDeployments() {
  const loaderData = useLoaderData<typeof loader>()

  return <AppDeploymentsPage {...loaderData} />
}
