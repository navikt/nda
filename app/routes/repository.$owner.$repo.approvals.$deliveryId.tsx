import { RepositoryManualApprovalPage } from '~/components/RepositoryManualApprovalPage'
import { getRepositoryApprovalPage, RepositoryApprovalError } from '~/db/repository-manual-approvals.server'
import { requireUser } from '~/lib/auth.server'
import { resolveApprovalRoute } from '~/lib/repository-approval-route.server'
import type { Route } from './+types/repository.$owner.$repo.approvals.$deliveryId'

export { action } from './repository.$owner.$repo.approvals.$deliveryId.actions.server'

export function meta() {
  return [{ title: 'Manuell repositorygodkjenning' }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { repository, deliveryId } = await resolveApprovalRoute(params, request)
  const user = await requireUser(request)
  try {
    const page = await getRepositoryApprovalPage(user, repository.id, deliveryId)
    return {
      repository: {
        id: repository.id,
        githubOwner: repository.github_owner,
        githubRepoName: repository.github_repo_name,
      },
      ...page,
    }
  } catch (error) {
    if (!(error instanceof RepositoryApprovalError)) throw error
    throw new Response(error.code === 'forbidden' ? 'Forbidden' : 'Not found', {
      status: error.code === 'forbidden' ? 403 : 404,
    })
  }
}

export default function RepositoryApprovalRoute({ loaderData }: Route.ComponentProps) {
  return <RepositoryManualApprovalPage key={`${loaderData.repository.id}:${loaderData.delivery.id}`} {...loaderData} />
}
