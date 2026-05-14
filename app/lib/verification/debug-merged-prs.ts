export interface MergedPullRequestWindowItem {
  number: number
  title: string
  htmlUrl: string
  mergedAt: string
  baseBranch: string
  headSha: string
  mergeCommitSha: string | null
  authorUsername: string | null
  mergedByUsername: string | null
}

interface DeploymentEvidence {
  deploymentId: number
  commitSha: string | null
  githubPrNumber: number | null
}

type MergedPrDeliveryClassification =
  | 'deployed_as_current_pr'
  | 'deployed_as_nearby_pr'
  | 'deployed_by_commit_sha'
  | 'not_observed_in_deployments'

interface MergedPrDeliveryResult {
  number: number
  title: string
  htmlUrl: string
  mergedAt: string
  baseBranch: string
  headSha: string
  mergeCommitSha: string | null
  authorUsername: string | null
  mergedByUsername: string | null
  classification: MergedPrDeliveryClassification
  matchedDeploymentIds: number[]
}

interface MergedPrWindowAnalysis {
  pullRequests: MergedPrDeliveryResult[]
  summary: {
    totalMergedPrs: number
    deliveredAsCurrentPr: number
    deliveredAsNearbyPr: number
    deliveredByCommitSha: number
    notObservedInDeployments: number
  }
}

export function analyzeMergedPrWindow(
  mergedPullRequests: MergedPullRequestWindowItem[],
  currentDeployment: DeploymentEvidence,
  nearbyDeployments: DeploymentEvidence[],
): MergedPrWindowAnalysis {
  const prToDeploymentIds = new Map<number, number[]>()
  const shaToDeploymentIds = new Map<string, number[]>()

  for (const deployment of [currentDeployment, ...nearbyDeployments]) {
    if (deployment.githubPrNumber !== null) {
      const existing = prToDeploymentIds.get(deployment.githubPrNumber) ?? []
      existing.push(deployment.deploymentId)
      prToDeploymentIds.set(deployment.githubPrNumber, existing)
    }

    if (deployment.commitSha) {
      const sha = deployment.commitSha.toLowerCase()
      const existing = shaToDeploymentIds.get(sha) ?? []
      existing.push(deployment.deploymentId)
      shaToDeploymentIds.set(sha, existing)
    }
  }

  const pullRequests = mergedPullRequests.map((pr): MergedPrDeliveryResult => {
    if (currentDeployment.githubPrNumber === pr.number) {
      return {
        ...pr,
        classification: 'deployed_as_current_pr',
        matchedDeploymentIds: [currentDeployment.deploymentId],
      }
    }

    const prMatchedDeployments = prToDeploymentIds.get(pr.number) ?? []
    const nearbyPrMatchedDeployments = prMatchedDeployments.filter((id) => id !== currentDeployment.deploymentId)
    if (nearbyPrMatchedDeployments.length > 0) {
      return {
        ...pr,
        classification: 'deployed_as_nearby_pr',
        matchedDeploymentIds: nearbyPrMatchedDeployments,
      }
    }

    const mergeCommitMatchedDeployments = pr.mergeCommitSha
      ? (shaToDeploymentIds.get(pr.mergeCommitSha.toLowerCase()) ?? [])
      : []
    const headShaMatchedDeployments = shaToDeploymentIds.get(pr.headSha.toLowerCase()) ?? []
    const matchedByCommitSha = Array.from(new Set([...mergeCommitMatchedDeployments, ...headShaMatchedDeployments]))

    if (matchedByCommitSha.length > 0) {
      return {
        ...pr,
        classification: 'deployed_by_commit_sha',
        matchedDeploymentIds: matchedByCommitSha,
      }
    }

    return {
      ...pr,
      classification: 'not_observed_in_deployments',
      matchedDeploymentIds: [],
    }
  })

  return {
    pullRequests,
    summary: {
      totalMergedPrs: pullRequests.length,
      deliveredAsCurrentPr: pullRequests.filter((pr) => pr.classification === 'deployed_as_current_pr').length,
      deliveredAsNearbyPr: pullRequests.filter((pr) => pr.classification === 'deployed_as_nearby_pr').length,
      deliveredByCommitSha: pullRequests.filter((pr) => pr.classification === 'deployed_by_commit_sha').length,
      notObservedInDeployments: pullRequests.filter((pr) => pr.classification === 'not_observed_in_deployments').length,
    },
  }
}
