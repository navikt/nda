import { RepositoryApprovalError, revokeRepositoryManualApproval } from '~/db/repository-manual-approvals.server'
import { fail, ok } from '~/lib/action-result'
import { requireUser } from '~/lib/auth.server'
import { getFormString } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { isSameOriginApprovalPost, resolveApprovalRoute } from '~/lib/repository-approval-route.server'
import { parseRepositoryApprovalId } from '~/lib/repository-manual-approval'
import type { Route } from './+types/repository.$owner.$repo.admin.code-deliveries.$deliveryId'

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  if (!isSameOriginApprovalPost(request)) return fail('Handlingen må sendes fra samme nettsted med POST.')
  const { repository, deliveryId } = await resolveApprovalRoute(params, request, true)
  const formData = await request.formData()
  if (getFormString(formData, 'intent') !== 'revoke-approval') return fail('Ukjent handling.')
  const approvalId = parseRepositoryApprovalId(getFormString(formData, 'approvalId'))
  const reason = getFormString(formData, 'reason')
  if (approvalId === null) return fail('Ugyldig godkjennings-ID.')
  if (!reason) return fail('Oppgi en begrunnelse for tilbakekallingen.')
  try {
    const revoked = await revokeRepositoryManualApproval(user, repository.id, deliveryId, approvalId, reason)
    logger.info('Repository manual approval revocation', {
      repository_id: repository.id,
      delivery_id: deliveryId,
      approval_id: approvalId,
      modified: revoked,
    })
    return revoked
      ? ok('Godkjenningen er tilbakekalt. Deploymentstatus er ikke endret.')
      : fail('Godkjenningen er allerede tilbakekalt. Ingen endring ble gjort.')
  } catch (error) {
    if (!(error instanceof RepositoryApprovalError)) throw error
    logger.info('Repository manual approval revocation rejected', {
      repository_id: repository.id,
      delivery_id: deliveryId,
      rejection_code: error.code,
    })
    return fail(
      error.code === 'forbidden'
        ? 'Du mangler administratortilgang til repositoryet.'
        : 'Godkjenningen finnes ikke i denne leveransen, eller begrunnelsen er ugyldig.',
    )
  }
}
