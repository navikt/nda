import { type EstablishmentGrounds, getEstablishmentContext } from '~/db/repository-code-delivery-establishment.server'
import { getCommitAncestryStatus, isCommitOnBranch } from '~/lib/github'
import { type AncestryStatus, decideEstablishmentGrounds } from './grounds'

export async function evaluateEstablishmentGrounds(deploymentId: number): Promise<EstablishmentGrounds | null> {
  const context = await getEstablishmentContext(deploymentId)
  if (!context) return null

  const { githubOwner, githubRepoName, defaultBranch, headSha, latestDeliveryHeadSha, headHasDelivery } = context
  const onApprovedBranch = defaultBranch
    ? await isCommitOnBranch(githubOwner, githubRepoName, headSha, defaultBranch)
    : null

  let ancestry: AncestryStatus | null | 'not_required' = 'not_required'
  if (onApprovedBranch === true && !headHasDelivery && latestDeliveryHeadSha) {
    ancestry = await getCommitAncestryStatus(
      githubOwner,
      githubRepoName,
      latestDeliveryHeadSha,
      headSha,
      context.githubRepoId,
    )
  }

  return decideEstablishmentGrounds({
    headSha,
    baseSha: latestDeliveryHeadSha,
    onApprovedBranch,
    ancestry,
  })
}
