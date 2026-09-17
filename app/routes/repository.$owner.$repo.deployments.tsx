import { redirect, useLoaderData } from 'react-router'
import { RepositoryDeploymentsPage } from '~/components/RepositoryDeploymentsPage'
import { getAllAppsLinkedToRepositoryId } from '~/db/repositories.server'
import { getUserIdentity } from '~/lib/auth.server'
import { getMultiAppDeploymentsPageData } from '~/lib/deployments/multi-app-deployments.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import type { Route } from './+types/repository.$owner.$repo.deployments'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    {
      title: data ? `Deployments - ${data.repository.github_owner}/${data.repository.github_repo_name}` : 'Deployments',
    },
  ]
}

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/deployments')

  const linkedApps = await getAllAppsLinkedToRepositoryId(repository.id)

  const parsedPage = parseInt(url.searchParams.get('page') || '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
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
  const teamFilter = url.searchParams.get('team') || ''

  const range = getDateRangeForPeriod(period)

  if (linkedApps.length === 0) {
    return {
      repository,
      deployments: [],
      total: 0,
      page: 1,
      total_pages: 0,
      userMappings: {},
      deployerOptions: [],
      currentUserGithub: null,
      errorReasons: {},
      teamOptions: [],
      teamFilterEmptyReason: null,
      hasUnmappedDeployers: false,
      goalOptions: [],
      triggerEventOptions: [],
      workflowFileOptions: [],
    }
  }

  const currentUser = await getUserIdentity(request)

  const data = await getMultiAppDeploymentsPageData(
    linkedApps,
    {
      page,
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

  if (page > data.total_pages && data.total_pages > 0) {
    url.searchParams.set('page', String(data.total_pages))
    throw redirect(url.pathname + url.search)
  }

  return {
    repository,
    ...data,
  }
}

export default function RepositoryDeploymentsRoute() {
  const loaderData = useLoaderData<typeof loader>()

  return <RepositoryDeploymentsPage {...loaderData} />
}
