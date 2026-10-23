import type { RepositoryDeliveryApprovalAssessment } from './repository-code-delivery/approval-assessment'
import type {
  assessRepositoryDeliveryInterval,
  RepositoryDeliveryIntervalAssessment,
} from './repository-code-delivery/interval-assessment'
import { MANUAL_TRIGGER_EVENTS } from './workflow-trigger-label'

interface RepositoryAuditDeployment {
  id: number
  naisDeploymentId: string
  title: string | null
  createdAt: string
  commitSha: string | null
  pullRequestNumber: number | null
  deployerUsername: string | null
  goalLinks: Array<{
    objectiveTitle: string
    keyResultTitle: string | null
    teamName: string
    periodLabel: string
  }>
  repositoryId: number | null
  deliveryId: number | null
  source: {
    branch: string | null
    defaultBranch: string | null
    triggerEvent: string | null
    triggerUrl: string | null
    repositoryAuthorization: { linkId: number; status: string } | null
    workflowSnapshot: { id: number; fetchedAt: string; runId: number; runAttempt: number | null } | null
  }
}

interface RepositoryAuditDelivery {
  id: number
  repositoryId: number
  githubRepoId: string
  githubOwner: string
  githubRepoName: string
  baseSha: string
  headSha: string
  interval: RepositoryDeliveryIntervalAssessment
  assessment: RepositoryDeliveryApprovalAssessment
  evidence: Parameters<typeof assessRepositoryDeliveryInterval>[0]
  sources: {
    comparisons: Array<{ id: number; fetchedAt: string }>
    associations: Array<{ id: number; fetchedAt: string }>
    pullRequests: Array<{ id: number; fetchedAt: string }>
    stackComparisons: Array<{ id: number; fetchedAt: string }>
  }
  authorIdentities: Array<{
    githubUsername: string
    activeNavIdent: string | null
    accountIdentityVersion: string
    userIdentityVersion: string | null
    accountDeletedAt: string | null
  }>
  manualApprovals: Array<{
    id: number
    snapshotId: number
    sha: string
    authorLogin: string | null
    authorNavIdent: string | null
    reviewerNavIdent: string
    registeredByNavIdent: string
    reviewedAt: string
    registeredAt: string
    documentation: string | null
    status: 'eligible' | 'revoked' | 'identity_or_interval_changed'
  }>
}

export interface RepositoryAuditReportData {
  schemaVersion: 2
  verificationSchemaVersion: number
  assessmentModel: 'repository'
  assessmentTime: 'generation'
  assessedAt: string
  app: { id: number; name: string; team: string; environment: string; testRequirement: string }
  period: { start: string; end: string }
  deployments: RepositoryAuditDeployment[]
  deliveries: RepositoryAuditDelivery[]
  deviations: Array<{
    id: number
    deploymentId: number
    date: string
    commitSha: string | null
    title: string | null
    githubOwner: string | null
    githubRepoName: string | null
    reason: string
    breachType: string | null
    intent: string | null
    severity: string | null
    followUpRole: string | null
    registeredBy: string
    registeredByName: string | null
    resolvedAt: string | null
    resolutionNote: string | null
  }>
  userDisplayNames: Record<string, string>
}

type RepositoryAuditBlocker =
  | 'missing_link'
  | 'incomplete_coverage'
  | 'missing_approval'
  | 'baseline_required'
  | 'manual_trigger'
  | 'unknown_trigger'
  | 'unknown_branch'
  | 'unauthorized_branch'
  | 'unknown_repository_authorization'
  | 'unauthorized_repository'

export const REPOSITORY_AUDIT_BLOCKER_LABELS: Record<RepositoryAuditBlocker, string> = {
  missing_link: 'Mangler kobling til kodeleveranse',
  incomplete_coverage: 'Ufullstendig kodedekning',
  missing_approval: 'Mangler kodegodkjenning',
  baseline_required: 'Tomt kodeintervall krever avklart baseline',
  manual_trigger: 'Manuelt trigget workflow',
  unknown_trigger: 'Ukjent workflow-trigger',
  unknown_branch: 'Ukjent branchgrunnlag',
  unauthorized_branch: 'Deployment er ikke fra default branch',
  unknown_repository_authorization: 'Ukjent repositorytillatelse',
  unauthorized_repository: 'Repository er ikke tillatt for applikasjonen',
}

export type RepositoryAuditReadiness = ReturnType<typeof assessRepositoryAuditReadiness>

export function assessRepositoryAuditReadiness(data: RepositoryAuditReportData) {
  const deliveries = new Map(data.deliveries.map((delivery) => [delivery.id, delivery]))
  const deployments = data.deployments.map((deployment) => {
    const blockers: RepositoryAuditBlocker[] = []
    const delivery = deployment.deliveryId === null ? null : deliveries.get(deployment.deliveryId)
    if (deployment.deliveryId !== null && !delivery) {
      throw new Error(`Missing report delivery ${deployment.deliveryId} for deployment ${deployment.id}`)
    }
    if (!delivery) blockers.push('missing_link')
    else if (delivery.assessment.status === 'incomplete') blockers.push('incomplete_coverage')
    else if (delivery.assessment.status === 'not_approved') blockers.push('missing_approval')
    else if (delivery.assessment.status === 'no_changes') blockers.push('baseline_required')

    const { triggerEvent, branch, defaultBranch } = deployment.source
    const authorization = deployment.source.repositoryAuthorization
    if (!authorization) blockers.push('unknown_repository_authorization')
    else if (authorization.status !== 'active') blockers.push('unauthorized_repository')
    if (!triggerEvent?.trim()) blockers.push('unknown_trigger')
    else if (MANUAL_TRIGGER_EVENTS.includes(triggerEvent)) blockers.push('manual_trigger')
    if (!branch?.trim() || !defaultBranch?.trim()) blockers.push('unknown_branch')
    else if (branch !== defaultBranch) blockers.push('unauthorized_branch')
    return { deploymentId: deployment.id, blockers }
  })
  return {
    isReady: deployments.every((deployment) => deployment.blockers.length === 0),
    noDeployments: deployments.length === 0,
    totalDeployments: deployments.length,
    deployments,
  }
}
