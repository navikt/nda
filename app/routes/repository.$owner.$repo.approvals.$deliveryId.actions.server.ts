import {
  createRepositoryApprovalReview,
  RepositoryApprovalError,
  registerRepositoryManualApproval,
} from '~/db/repository-manual-approvals.server'
import { fail, ok } from '~/lib/action-result'
import { requireUser } from '~/lib/auth.server'
import { getFormString } from '~/lib/form-validators'
import { isFullCommitSha } from '~/lib/git-constants'
import { logger } from '~/lib/logger.server'
import { isSameOriginApprovalPost, resolveApprovalRoute } from '~/lib/repository-approval-route.server'
import { isDocumentationUrl, parseRepositoryApprovalId, parseReviewTime } from '~/lib/repository-manual-approval'
import type { Route } from './+types/repository.$owner.$repo.approvals.$deliveryId'

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  if (!isSameOriginApprovalPost(request)) return fail('Handlingen må sendes fra samme nettsted med POST.')
  const { repository, deliveryId } = await resolveApprovalRoute(params, request)
  const formData = await request.formData()
  const intent = getFormString(formData, 'intent')
  try {
    if (intent === 'start-review') {
      const review = await createRepositoryApprovalReview(user, repository.id, deliveryId)
      logger.info('Repository approval snapshot created', {
        repository_id: repository.id,
        delivery_id: deliveryId,
        snapshot_id: review.snapshotId,
      })
      return { ...ok('Vurderingsgrunnlaget er fryst. Gjennomgå det før du bekrefter.'), review }
    }
    if (intent !== 'register-approval') return fail('Ukjent handling.')
    const snapshotId = parseRepositoryApprovalId(getFormString(formData, 'snapshotId'))
    const commitShas = formData.getAll('commitShas')
    const reviewedAt = parseReviewTime(getFormString(formData, 'reviewedAt') ?? '')
    const reviewDocumentation = getFormString(formData, 'reviewDocumentation')
    const documentationUrl = getFormString(formData, 'documentationUrl') || null
    if (snapshotId === null) return fail('Start en gjennomgang for å få et gyldig vurderingsgrunnlag.')
    if (
      commitShas.length === 0 ||
      !commitShas.every((sha): sha is string => typeof sha === 'string' && isFullCommitSha(sha)) ||
      new Set(commitShas.map((sha) => sha.toLowerCase())).size !== commitShas.length
    )
      return fail('Velg minst én gyldig commit, uten duplikater.')
    if (!reviewDocumentation) return fail('Beskriv hva du har gjennomgått.')
    if (documentationUrl && !isDocumentationUrl(documentationUrl))
      return fail('Dokumentasjonslenken må være en gyldig http- eller https-adresse.')
    if (!reviewedAt) return fail('Oppgi faktisk tidspunkt for gjennomgangen med tidssone.')
    const approvalId = await registerRepositoryManualApproval(user, repository.id, deliveryId, {
      snapshotId,
      commitShas,
      reviewedAt,
      reviewDocumentation,
      documentationUrl,
    })
    logger.info('Repository manual approval registered', {
      repository_id: repository.id,
      delivery_id: deliveryId,
      approval_id: approvalId,
    })
    return { ...ok('Repositorygodkjenningen er registrert. Deploymentstatus er ikke endret.'), registered: true }
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
      forbidden: 'Du har ikke lenger rett til å godkjenne dette repositoryet.',
      not_found: 'Leveransen eller vurderingsgrunnlaget finnes ikke i dette repositoryet.',
      stale_ground:
        'Evidens eller identitet er endret. Ingenting er lagret. Start en ny gjennomgang og vurder det nye grunnlaget.',
      incomplete_evidence:
        'Grunnlaget er ufullstendig. Kontroller PR-grunnlag, forfatteridentitet og lagret committer-tid. Ingen alternativ tid brukes.',
      invalid_approval:
        'Godkjenningen er ugyldig. Du kan ikke velge egne commits. Tidspunktet kan ikke være i fremtiden eller før den nyeste valgte committens lagrede committer-tid.',
    }
    return { ...fail(messages[error.code]), stale: error.code === 'stale_ground' }
  }
}
