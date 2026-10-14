import { getRepositoryCodeDeliveryExportData } from '~/db/repository-code-delivery-overview.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { fetchRepositoryDiagnosticGitHubEvidence } from '~/lib/github/repository-diagnostic-evidence.server'
import { createRepositoryCodeDeliveryJson } from '~/lib/repository-code-delivery-json'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo.admin.code-deliveries.export'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/admin/code-deliveries/export')
  const { authorized } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const requestedDeploymentId = url.searchParams.get('deploymentId')
  const unresolvedDeploymentId = requestedDeploymentId === null ? undefined : Number(requestedDeploymentId)
  if (
    unresolvedDeploymentId !== undefined &&
    (!Number.isSafeInteger(unresolvedDeploymentId) ||
      unresolvedDeploymentId <= 0 ||
      unresolvedDeploymentId > 2_147_483_647)
  ) {
    throw new Response('A valid unresolved deploymentId is required when provided', { status: 400 })
  }

  const exportData = await getRepositoryCodeDeliveryExportData(repository.id, unresolvedDeploymentId)
  if (
    unresolvedDeploymentId !== undefined &&
    !exportData.diagnosticTargets.some((target) => target.unresolvedDeploymentId === unresolvedDeploymentId)
  ) {
    throw new Response('Open unresolved deployment not found for this repository', { status: 404 })
  }
  const filename = unresolvedDeploymentId
    ? `repository-${repository.id}-deployment-${unresolvedDeploymentId}-diagnostic.json`
    : `repository-${repository.id}-unresolved-deployments-diagnostic.json`
  const liveGitHubEvidence = await fetchRepositoryDiagnosticGitHubEvidence({
    owner: exportData.repositoryMetadata.github_owner,
    repo: exportData.repositoryMetadata.github_repo_name,
    githubRepoId: exportData.repositoryMetadata.github_repo_id,
    repositoryAliases: exportData.repositoryAliases,
    deployments: exportData.deployments,
    verificationRuns: exportData.verificationRuns,
    prSnapshots: exportData.prSnapshots,
    workflowRunSnapshots: exportData.workflowRunSnapshots,
  })
  const json = createRepositoryCodeDeliveryJson({
    repository: {
      id: repository.id,
      githubRepositoryId: exportData.repositoryMetadata.github_repo_id,
      owner: exportData.repositoryMetadata.github_owner,
      name: exportData.repositoryMetadata.github_repo_name,
      defaultBranch: exportData.repositoryMetadata.default_branch,
      trackingSince: exportData.repositoryMetadata.code_delivery_tracking_since,
      auditStartYear: exportData.repositoryMetadata.audit_start_year,
    },
    historyReadiness: exportData.historyReadiness,
    implicitApprovalMode: exportData.implicitApprovalMode,
    deployments: exportData.deployments,
    deliveries: exportData.deliveries,
    ancestryEvidence: {
      matchingCompareSnapshots: exportData.ancestryEvidence,
      linkageNote:
        'Snapshots are matched by repository ID and the unordered pair of a deployment SHA and a registered delivery head SHA. They are not directly linked to the unresolved record or retry that triggered the GitHub call.',
    },
    verificationRuns: exportData.verificationRuns,
    repositoryConfigAuditLog: exportData.repositoryConfigAuditLog,
    diagnosticTargets: exportData.diagnosticTargets,
    prSnapshots: exportData.prSnapshots,
    commitSnapshots: exportData.commitSnapshots,
    workflowRunSnapshots: exportData.workflowRunSnapshots,
    liveGitHubEvidence,
  })
  return new Response(json, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
