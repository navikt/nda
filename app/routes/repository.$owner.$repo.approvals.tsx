import { RepositoryApprovalDeliveriesPage } from '~/components/RepositoryApprovalDeliveriesPage'
import { getRepositoryApprovalDeliveries, RepositoryApprovalError } from '~/db/repository-manual-approvals.server'
import { requireUser } from '~/lib/auth.server'
import { parseRepositoryApprovalId } from '~/lib/repository-manual-approval'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo.approvals'

export function meta() {
  return [{ title: 'Leveranser til manuell repositorygodkjenning' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const rawRepositoryId = url.searchParams.get('repositoryId')
  if (rawRepositoryId !== null && parseRepositoryApprovalId(rawRepositoryId) === null)
    throw new Response('Invalid repository ID', { status: 400 })
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/approvals')
  if (rawRepositoryId !== null && Number(rawRepositoryId) !== repository.id)
    throw new Response('Repository scope mismatch', { status: 400 })
  const page = parseRepositoryApprovalId(url.searchParams.get('page') ?? '1')
  if (page === null) throw new Response('Invalid page', { status: 400 })
  try {
    const deliveries = await getRepositoryApprovalDeliveries(user, repository.id, page)
    return {
      repository: {
        id: repository.id,
        githubOwner: repository.github_owner,
        githubRepoName: repository.github_repo_name,
      },
      ...deliveries,
    }
  } catch (error) {
    if (!(error instanceof RepositoryApprovalError)) throw error
    throw new Response('Forbidden', { status: 403 })
  }
}

export default function RepositoryApprovalDeliveriesRoute({ loaderData }: Route.ComponentProps) {
  return <RepositoryApprovalDeliveriesPage {...loaderData} />
}
