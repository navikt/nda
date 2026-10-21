import { RepositoryCodeDeliveryEvidencePage } from '~/components/RepositoryCodeDeliveryEvidencePage'
import { withTransaction } from '~/db/connection.server'
import { getRepositoryCodeDeliveryEvidence } from '~/db/repository-code-delivery-overview.server'
import { getRepositoryManualApprovalHistoryForAdmin } from '~/db/repository-manual-approvals.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryApprovalCapabilities } from '~/lib/authorization.server'
import { presentRepositoryApprovalHistory } from '~/lib/repository-approval-history.server'
import { assessStoredRepositoryDeliveryApproval } from '~/lib/repository-code-delivery/approval-assessment'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import { serializeUserLookups } from '~/lib/user-display'
import type { Route } from './+types/repository.$owner.$repo.admin.code-deliveries.$deliveryId'

export { action } from './repository.$owner.$repo.admin.code-deliveries.$deliveryId.actions.server'

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
  const { canAccessAdmin, canApprove } = await resolveRepositoryApprovalCapabilities(user, repository.id)
  if (!canAccessAdmin) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const delivery = await getRepositoryCodeDeliveryEvidence(repository.id, deliveryId, page, client)
    if (!delivery) throw new Response('Code delivery not found', { status: 404 })
    const history = await getRepositoryManualApprovalHistoryForAdmin(user, repository.id, deliveryId, client)

    const relevantUsernames = [
      ...new Set([
        ...delivery.deployments.flatMap((deployment) =>
          deployment.verification_runs.flatMap((run) =>
            run.review_snapshots.flatMap((snapshot) => snapshot.reviews?.map((review) => review.username) ?? []),
          ),
        ),
        ...delivery.interval_assessment.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
      ]),
    ]
    const githubUserLookups =
      relevantUsernames.length > 0 ? await getGithubUserLookups(relevantUsernames, client) : new Map()
    const activeGithubUserLookups = new Map(
      [...githubUserLookups].map(([username, lookup]) => [
        username,
        {
          ...lookup,
          nav_ident: lookup.account_deleted_at === null ? lookup.active_nav_ident : null,
        },
      ]),
    )
    const userMappings = serializeUserLookups(activeGithubUserLookups)
    const approvalAssessment = assessStoredRepositoryDeliveryApproval(
      delivery,
      delivery.interval_assessment,
      history.commits,
      new Map([...activeGithubUserLookups].map(([username, lookup]) => [username, lookup.nav_ident])),
    )

    return {
      repository: {
        id: repository.id,
        githubOwner: repository.github_owner,
        githubRepoName: repository.github_repo_name,
      },
      delivery,
      approvalAssessment,
      manualApprovalHistory: presentRepositoryApprovalHistory(history),
      canApprove,
      canRevoke: true,
      userMappings,
    }
  })
}

export default function RepositoryCodeDeliveryEvidenceRoute({ loaderData }: Route.ComponentProps) {
  return <RepositoryCodeDeliveryEvidencePage {...loaderData} />
}
