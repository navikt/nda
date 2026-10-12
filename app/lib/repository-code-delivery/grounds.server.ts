import { type EstablishmentGrounds, getEstablishmentContext } from '~/db/repository-code-delivery-establishment.server'
import { getCommitAncestryStatus, getRepositoryId, isCommitOnBranch } from '~/lib/github'
import { type AncestryStatus, decideEstablishmentGrounds } from './grounds'

export async function evaluateEstablishmentGrounds(deploymentId: number): Promise<EstablishmentGrounds | null> {
  const context = await getEstablishmentContext(deploymentId)
  if (!context) return null

  const { githubOwner, githubRepoName, defaultBranch, headSha, latestDeliveryHeadSha, headHasDelivery } = context
  const currentGithubRepoId = await getRepositoryId(githubOwner, githubRepoName)
  if (currentGithubRepoId !== context.githubRepoId) {
    return { confirmed: false, reason: 'source_unauthorized', headSha }
  }

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
