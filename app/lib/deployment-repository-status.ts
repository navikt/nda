import type { RepositoryDeliveryApprovalAssessment } from './repository-code-delivery/approval-assessment'

export type DeploymentRepositoryStatus = RepositoryDeliveryApprovalAssessment['status'] | 'missing_link'

export const DEPLOYMENT_REPOSITORY_STATUS_LABELS: Record<DeploymentRepositoryStatus, string> = {
  approved: 'Alle commits dekket',
  not_approved: 'Udekkede commits',
  incomplete: 'Ufullstendig grunnlag',
  missing_link: 'Mangler leveransekobling',
  no_changes: 'Anker – ingen kodeendringer',
}

export function parseDeploymentRepositoryStatus(
  value: string | null | undefined,
): DeploymentRepositoryStatus | undefined {
  return value && Object.hasOwn(DEPLOYMENT_REPOSITORY_STATUS_LABELS, value)
    ? (value as DeploymentRepositoryStatus)
    : undefined
}

export interface DeploymentRepositorySummary {
  status: DeploymentRepositoryStatus
  range: { baseSha: string; headSha: string } | null
  repository?: { githubOwner: string; githubRepoName: string }
}
