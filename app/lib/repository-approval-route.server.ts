import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { parseRepositoryApprovalId } from './repository-manual-approval'
import { requireParams } from './route-params.server'

export async function resolveApprovalRoute(
  params: Record<string, string | undefined>,
  request: Request,
  admin = false,
) {
  const { owner, repo, deliveryId: rawDeliveryId } = requireParams(params, ['owner', 'repo', 'deliveryId'])
  const deliveryId = parseRepositoryApprovalId(rawDeliveryId)
  if (deliveryId === null) throw new Response('Invalid delivery ID', { status: 400 })
  const url = new URL(request.url)
  const rawRepositoryId = url.searchParams.get('repositoryId')
  if (rawRepositoryId !== null && parseRepositoryApprovalId(rawRepositoryId) === null) {
    throw new Response('Invalid repository ID', { status: 400 })
  }
  const suffix = admin ? `/admin/code-deliveries/${deliveryId}` : `/approvals/${deliveryId}`
  const repository = await resolveRepositoryFromParams(owner, repo, url, suffix)
  if (rawRepositoryId !== null && Number(rawRepositoryId) !== repository.id) {
    throw new Response('Repository scope mismatch', { status: 400 })
  }
  return { repository, deliveryId }
}

export function isSameOriginApprovalPost(request: Request): boolean {
  if (request.method !== 'POST') return false
  const origin = request.headers.get('Origin')
  return origin === new URL(request.url).origin && request.headers.get('Sec-Fetch-Site') !== 'cross-site'
}
