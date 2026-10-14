import {
  getRepositoryHistoryReadiness,
  listRepositoryCodeDeliveryAncestryEvidence,
  listRepositoryCodeDeliveryExportRows,
} from '~/db/repository-code-delivery-overview.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
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

  const [deployments, ancestryEvidence, historyReadiness] = await Promise.all([
    listRepositoryCodeDeliveryExportRows(repository.id),
    listRepositoryCodeDeliveryAncestryEvidence(repository.id),
    getRepositoryHistoryReadiness(repository.id),
  ])
  const json = createRepositoryCodeDeliveryJson({
    repository: {
      id: repository.id,
      githubRepositoryId: repository.github_repo_id,
      owner: repository.github_owner,
      name: repository.github_repo_name,
      defaultBranch: repository.default_branch,
      trackingSince: repository.code_delivery_tracking_since,
      auditStartYear: repository.audit_start_year,
    },
    historyReadiness,
    deployments,
    ancestryEvidence: {
      matchingCompareSnapshots: ancestryEvidence,
      linkageNote:
        'Snapshots are matched by repository ID and the unordered pair of a deployment SHA and a registered delivery head SHA. They are not directly linked to the unresolved record or retry that triggered the GitHub call.',
    },
  })
  return new Response(json, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="repository-${repository.id}-deployment-history.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
