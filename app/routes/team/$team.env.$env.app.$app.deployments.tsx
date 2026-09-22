import { redirect, useLoaderData } from 'react-router'
import { AppDeploymentsPage } from '~/components/AppDeploymentsPage'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getMonorepoSiblings } from '~/db/monorepo.server'
import { getUserIdentity } from '~/lib/auth.server'
import { getMultiAppDeploymentsPageData } from '~/lib/deployments/multi-app-deployments.server'
import { parsePerPage } from '~/lib/pagination'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
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
  const perPage = parsePerPage(url.searchParams.get('perPage'))
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
  const showAllEnvironments = url.searchParams.get('monorepo') === 'true'
  const teamFilter = url.searchParams.get('team') || ''

  const range = getDateRangeForPeriod(period)

  const monorepo = await getMonorepoSiblings(app.id)
  const allSiblings = monorepo?.siblings ?? []
  const monorepoInfo = monorepo
    ? {
        github_owner: monorepo.github_owner,
        github_repo_name: monorepo.github_repo_name,
        repository_id: monorepo.repository_id,
      }
    : null
  const hasMonorepoSiblings = allSiblings.length > 0
  const useMultiApp = showAllEnvironments && hasMonorepoSiblings && monorepoInfo?.repository_id == null

  const currentUser = await getUserIdentity(request)

  const apps = useMultiApp
    ? [{ id: app.id, team_slug: app.team_slug }, ...allSiblings.map((s) => ({ id: s.id, team_slug: s.team_slug }))]
    : [{ id: app.id, team_slug: app.team_slug }]

  const multiAppData = await getMultiAppDeploymentsPageData(
    apps,
    {
      page,
      perPage,
      status,
      method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
      goal,
      goalObjectiveId: goalObjectiveId && !Number.isNaN(goalObjectiveId) ? goalObjectiveId : undefined,
      deployer,
      sha,
      triggerEvent,
      workflowPath,
      startDate: range?.startDate,
      endDate: range?.endDate,
      teamFilter,
    },
    currentUser,
  )

  if (page > multiAppData.total_pages && multiAppData.total_pages > 0) {
    url.searchParams.set('page', String(multiAppData.total_pages))
    throw redirect(url.pathname + url.search)
  }

  return {
    app,
    hasMonorepoSiblings,
    showAllEnvironments: useMultiApp,
    monorepo: monorepoInfo,
    ...multiAppData,
  }
}

export default function AppDeployments() {
  const loaderData = useLoaderData<typeof loader>()

  return <AppDeploymentsPage {...loaderData} />
}
