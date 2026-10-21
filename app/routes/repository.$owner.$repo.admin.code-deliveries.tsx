import { useNavigate } from 'react-router'
import { RepositoryCodeDeliveriesPage } from '~/components/RepositoryCodeDeliveriesPage'
import { withTransaction } from '~/db/connection.server'
import { getRepositoryCodeDeliveryFollowUp } from '~/db/repository-code-delivery-follow-up.server'
import {
  getRepositoryCodeDeliveryOverview,
  getRepositoryHistoryReadiness,
  listOpenUnresolvedCodeDeployments,
  type RepositoryCodeDeliverySortDirection,
  type RepositoryCodeDeliverySortKey,
} from '~/db/repository-code-delivery-overview.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryApprovalCapabilities } from '~/lib/authorization.server'
import type { RepositoryDeliveryApprovalAssessment } from '~/lib/repository-code-delivery/approval-assessment'
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

type FollowUpFilter = RepositoryDeliveryApprovalAssessment['status'] | 'all'

function parseFollowUpFilter(value: string | null): FollowUpFilter {
  return value === 'approved' || value === 'not_approved' || value === 'incomplete' || value === 'no_changes'
    ? value
    : 'all'
}

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
  status: FollowUpFilter = 'all',
): URLSearchParams {
  const searchParams = new URLSearchParams({ repositoryId: String(repositoryId), page: String(page) })
  if (sort) {
    searchParams.set('sort', sort.orderBy)
    searchParams.set('direction', sort.direction)
  }
  if (status !== 'all') searchParams.set('status', status)
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

  const parsedPage = parseInt(url.searchParams.get('page') || '1', 10)
  const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const status = parseFollowUpFilter(url.searchParams.get('status'))
  const requestedSortKey = url.searchParams.get('sort')
  const requestedSortDirection = url.searchParams.get('direction')
  const sort =
    isDeliverySortKey(requestedSortKey) && isDeliverySortDirection(requestedSortDirection)
      ? {
          orderBy: requestedSortKey,
          direction: requestedSortDirection,
        }
      : undefined

  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { canAccessAdmin, canApprove } = await resolveRepositoryApprovalCapabilities(user, repository.id, client)
    if (!canAccessAdmin) throw new Response('Forbidden - admin access required', { status: 403 })
    const [overview, unresolved, historyReadiness, followUp] = await Promise.all([
      getRepositoryCodeDeliveryOverview(repository.id, client),
      listOpenUnresolvedCodeDeployments(repository.id, UNRESOLVED_LIMIT, client),
      getRepositoryHistoryReadiness(repository.id, client),
      getRepositoryCodeDeliveryFollowUp(
        repository.id,
        { page: requestedPage, pageSize: PAGE_SIZE, status, sort },
        client,
      ),
    ])

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
      deliveries: followUp.deliveries,
      followUpCounts: followUp.counts,
      filteredTotal: followUp.total,
      status,
      canApprove,
      unresolved,
      page: followUp.page,
      totalPages: followUp.totalPages,
      sort,
    }
  })
}

export default function RepositoryCodeDeliveriesRoute({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const { repository, sort, status } = loaderData

  const updateSearchParams = (
    page: number,
    nextSort: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection } | undefined,
  ) => {
    const searchParams = createDeliverySearchParams(repository.id, page, nextSort, status)
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
