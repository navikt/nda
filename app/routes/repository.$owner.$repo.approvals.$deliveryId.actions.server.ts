import { approveRepositoryDelivery, RepositoryApprovalError } from '~/db/repository-manual-approvals.server'
import { fail, ok } from '~/lib/action-result'
import { requireUser } from '~/lib/auth.server'
import { getFormString } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { isSameOriginApprovalPost, resolveApprovalRoute } from '~/lib/repository-approval-route.server'
import type { Route } from './+types/repository.$owner.$repo.approvals.$deliveryId'

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  if (!isSameOriginApprovalPost(request)) return fail('Handlingen må sendes fra samme nettsted med POST.')
  const { repository, deliveryId } = await resolveApprovalRoute(params, request)
  const formData = await request.formData()
  const intent = getFormString(formData, 'intent')
  try {
    if (intent !== 'approve-repository') return fail('Ukjent handling.')
    const previewToken = getFormString(formData, 'previewToken')
    const note = getFormString(formData, 'note') || null
    if (!previewToken || !/^[a-f0-9]{64}$/.test(previewToken))
      return fail('Oppdater siden og kontroller vurderingsgrunnlaget før du godkjenner.')
    if (note && note.length > 5000) return fail('Kommentaren kan ikke være lengre enn 5000 tegn.')
    const approval = await approveRepositoryDelivery(user, repository.id, deliveryId, {
      previewToken,
      note,
    })
    logger.info('Repository manual approval registered', {
      repository_id: repository.id,
      delivery_id: deliveryId,
      approval_id: approval.approvalId,
      approved_commit_count: approval.commitShas.length,
    })
    return {
      ...ok('Godkjenning registrert for commits som manglet PR-dekning. Deploymentstatus er ikke endret.'),
      registered: true,
    }
  } catch (error) {
    if (!(error instanceof RepositoryApprovalError)) throw error
    logger.info('Repository manual approval rejected', {
      repository_id: repository.id,
      delivery_id: deliveryId,
      rejection_code: error.code,
    })
    const messages = {
      commit_outside_snapshot:
        'En valgt commit finnes ikke i det fryste vurderingsgrunnlaget. Velg bare commits fra denne gjennomgangen.',
      no_approvable_commits:
        'Ingen commits mangler kjent PR-dekning og kan godkjennes av deg. Ukjent PR-grunnlag kan ikke godkjennes manuelt.',
      forbidden: 'Du har ikke lenger rett til å godkjenne dette repositoryet.',
      not_found: 'Leveransen eller vurderingsgrunnlaget finnes ikke i dette repositoryet.',
      stale_ground:
        'Evidens eller identitet er endret. Ingenting er lagret. Start en ny gjennomgang og vurder det nye grunnlaget.',
      incomplete_evidence:
        'Grunnlaget er ufullstendig. Ukjent PR-grunnlag eller forfatteridentitet kan ikke godkjennes manuelt.',
      invalid_approval:
        'Godkjenningen kunne ikke registreres. Du kan ikke godkjenne egne commits eller commits som allerede er dekket av PR-review.',
    }
    return { ...fail(messages[error.code]), stale: error.code === 'stale_ground' }
  }
}
