import { useNavigate } from 'react-router'
import { RepositoryCodeDeliveriesPage } from '~/components/RepositoryCodeDeliveriesPage'
import { getRepositoryCodeDeliveryIntervalAssessments } from '~/db/repository-code-delivery-interval-assessment.server'
import {
  getRepositoryCodeDeliveryOverview,
  getRepositoryHistoryReadiness,
  listOpenUnresolvedCodeDeployments,
  listRepositoryCodeDeliveries,
  type RepositoryCodeDeliverySortDirection,
  type RepositoryCodeDeliverySortKey,
} from '~/db/repository-code-delivery-overview.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo.admin.code-deliveries'

const PAGE_SIZE = 20
const UNRESOLVED_LIMIT = 100
const DELIVERY_SORT_KEYS = new Set<string>([
  'first_deployed_at',
  'created_at',
  'base_sha',
  'head_sha',
  'deployment_count',
  'app_names',
])

function isDeliverySortKey(value: string | null): value is RepositoryCodeDeliverySortKey {
  return value !== null && DELIVERY_SORT_KEYS.has(value)
}

function isDeliverySortDirection(value: string | null): value is RepositoryCodeDeliverySortDirection {
  return value === 'ascending' || value === 'descending'
}

export function getNextDeliverySort(
  currentSort: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection } | undefined,
  sortKey: string,
): { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection } | undefined {
  if (!isDeliverySortKey(sortKey)) return currentSort
  if (currentSort?.orderBy === sortKey && currentSort.direction === 'descending') return undefined
  return {
    orderBy: sortKey,
    direction: currentSort?.orderBy === sortKey ? 'descending' : 'ascending',
  }
}

export function createDeliverySearchParams(
  repositoryId: number,
  page: number,
  sort: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection } | undefined,
): URLSearchParams {
  const searchParams = new URLSearchParams({ repositoryId: String(repositoryId), page: String(page) })
  if (sort) {
    searchParams.set('sort', sort.orderBy)
    searchParams.set('direction', sort.direction)
  }
  return searchParams
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    {
      title: data
        ? `Kodeleveranser - ${data.repository.githubOwner}/${data.repository.githubRepoName}`
        : 'Kodeleveranser',
    },
  ]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/admin/code-deliveries')

  const { authorized } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const parsedPage = parseInt(url.searchParams.get('page') || '1', 10)
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const requestedSortKey = url.searchParams.get('sort')
  const requestedSortDirection = url.searchParams.get('direction')
  const sort =
    isDeliverySortKey(requestedSortKey) && isDeliverySortDirection(requestedSortDirection)
      ? {
          orderBy: requestedSortKey,
          direction: requestedSortDirection,
        }
      : undefined

  const [overview, unresolved, historyReadiness] = await Promise.all([
    getRepositoryCodeDeliveryOverview(repository.id),
    listOpenUnresolvedCodeDeployments(repository.id, UNRESOLVED_LIMIT),
    getRepositoryHistoryReadiness(repository.id),
  ])
  const totalPages = Math.max(1, Math.ceil(overview.deliveryCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const deliveries = await listRepositoryCodeDeliveries(repository.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    sort,
  })
  const deliveryAssessments = await getRepositoryCodeDeliveryIntervalAssessments(repository.id, deliveries)
  const assessmentsByDeliveryId = new Map(deliveryAssessments.map((item) => [item.deliveryId, item]))
  const deliveriesWithAssessment = deliveries.map((delivery) => {
    const assessment = assessmentsByDeliveryId.get(delivery.id)
    if (!assessment) throw new Error(`Missing interval assessment for delivery ${delivery.id}`)
    const { state, totalCommits, listedCommits, summary } = assessment.assessment
    return {
      ...delivery,
      assessment: { state, totalCommits, listedCommits, summary },
      pullRequestNumbers: assessment.pullRequestNumbers,
    }
  })

  return {
    repository: {
      id: repository.id,
      githubOwner: repository.github_owner,
      githubRepoName: repository.github_repo_name,
    },
    tracking: {
      enabled: repository.code_delivery_tracking,
      since: repository.code_delivery_tracking_since,
    },
    overview,
    historyReadiness,
    deliveries: deliveriesWithAssessment,
    unresolved,
    page,
    totalPages,
    sort,
  }
}

export default function RepositoryCodeDeliveriesRoute({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const { repository, sort } = loaderData

  const updateSearchParams = (
    page: number,
    nextSort: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection } | undefined,
  ) => {
    const searchParams = createDeliverySearchParams(repository.id, page, nextSort)
    navigate(`?${searchParams}`)
  }

  return (
    <RepositoryCodeDeliveriesPage
      {...loaderData}
      onPageChange={(page) => updateSearchParams(page, sort)}
      onSortChange={(sortKey) => {
        updateSearchParams(1, getNextDeliverySort(sort, sortKey))
      }}
    />
  )
}
