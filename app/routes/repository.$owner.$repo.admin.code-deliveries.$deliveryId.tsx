import { RepositoryCodeDeliveryEvidencePage } from '~/components/RepositoryCodeDeliveryEvidencePage'
import { getRepositoryCodeDeliveryEvidence } from '~/db/repository-code-delivery-overview.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import { serializeUserLookups } from '~/lib/user-display'
import type { Route } from './+types/repository.$owner.$repo.admin.code-deliveries.$deliveryId'

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: loaderData
        ? `Review-grunnlag - ${loaderData.repository.githubOwner}/${loaderData.repository.githubRepoName}`
        : 'Review-grunnlag',
    },
  ]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo, deliveryId: rawDeliveryId } = requireParams(params, ['owner', 'repo', 'deliveryId'])
  const deliveryId = Number.parseInt(rawDeliveryId, 10)
  if (
    !/^\d+$/.test(rawDeliveryId) ||
    !Number.isFinite(deliveryId) ||
    !Number.isSafeInteger(deliveryId) ||
    deliveryId <= 0 ||
    deliveryId > 2_147_483_647
  ) {
    throw new Response('Invalid delivery ID', { status: 400 })
  }

  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, `/admin/code-deliveries/${deliveryId}`)
  const { authorized } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const delivery = await getRepositoryCodeDeliveryEvidence(repository.id, deliveryId, page)
  if (!delivery) throw new Response('Code delivery not found', { status: 404 })

  const reviewerUsernames = [
    ...new Set(
      delivery.deployments.flatMap((deployment) =>
        deployment.verification_runs.flatMap((run) =>
          run.review_snapshots.flatMap((snapshot) => snapshot.reviews?.map((review) => review.username) ?? []),
        ),
      ),
    ),
  ]
  const userMappings = serializeUserLookups(
    reviewerUsernames.length > 0 ? await getGithubUserLookups(reviewerUsernames) : new Map(),
  )

  return {
    repository: {
      id: repository.id,
      githubOwner: repository.github_owner,
      githubRepoName: repository.github_repo_name,
    },
    delivery,
    userMappings,
  }
}

export default function RepositoryCodeDeliveryEvidenceRoute({ loaderData }: Route.ComponentProps) {
  return <RepositoryCodeDeliveryEvidencePage {...loaderData} />
}
