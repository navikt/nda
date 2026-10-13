import { useNavigate } from 'react-router'
import { RepositoryCodeDeliveriesPage } from '~/components/RepositoryCodeDeliveriesPage'
import {
  getRepositoryCodeDeliveryOverview,
  listOpenUnresolvedCodeDeployments,
  listRepositoryCodeDeliveries,
} from '~/db/repository-code-delivery-overview.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo.admin.code-deliveries'

const PAGE_SIZE = 20
const UNRESOLVED_LIMIT = 100

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

  const [overview, unresolved] = await Promise.all([
    getRepositoryCodeDeliveryOverview(repository.id),
    listOpenUnresolvedCodeDeployments(repository.id, UNRESOLVED_LIMIT),
  ])
  const totalPages = Math.max(1, Math.ceil(overview.deliveryCount / PAGE_SIZE))
  const page = Math.min(requestedPage, totalPages)
  const deliveries = await listRepositoryCodeDeliveries(repository.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
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
    deliveries,
    unresolved,
    page,
    totalPages,
  }
}

export default function RepositoryCodeDeliveriesRoute({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const { repository } = loaderData

  return (
    <RepositoryCodeDeliveriesPage
      {...loaderData}
      onPageChange={(page) => navigate(`?repositoryId=${repository.id}&page=${page}`)}
    />
  )
}
