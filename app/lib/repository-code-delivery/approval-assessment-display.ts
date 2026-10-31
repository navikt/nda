import { isGitHubBot } from '~/lib/github-bots'
import type { RepositoryDeliveryApprovalAssessment } from './approval-assessment'

export function isRepositoryBotAuthor(username: string | null | undefined): boolean {
  const normalized = username?.toLowerCase()
  return normalized === 'dependabot' || isGitHubBot(normalized)
}

export function approvalStatusLabel(status: RepositoryDeliveryApprovalAssessment['status']): string {
  if (status === 'approved') return 'Hele intervallet er dekket'
  if (status === 'not_approved') return 'Krever manuell godkjenning'
  if (status === 'no_changes') return 'Ingen commits i intervallet'
  return 'Kan ikke vurderes'
}

export function approvalCommitReasonLabel(
  reason: RepositoryDeliveryApprovalAssessment['commits'][number]['reason'],
): string {
  const labels: Record<RepositoryDeliveryApprovalAssessment['commits'][number]['reason'], string> = {
    approved_pr: 'Dekket av PR etter NDA sine eksisterende regler',
    manual_approval: 'Dekket av manuell godkjenning',
    missing_approval: 'Ingen manuell godkjenning dekker denne commiten',
    unknown_pr_coverage: 'PR-kobling eller review-grunnlag er ukjent',
    unknown_commit_author: 'Commit author mangler verifisert GitHub-konto eller kobling til NAV-ident',
    unknown_approver_identity: 'Godkjenner kan ikke kobles sikkert til en NAV-ident',
    incomplete_commit_history: 'Commit-historikken er ufullstendig',
    invalid_interval: 'Commit-historikken samsvarer ikke med leveranseintervallet',
    duplicate_commit: 'Commit-historikken inneholder duplikate commits',
    approval_outside_interval: 'En godkjenning viser til en commit utenfor intervallet',
  }
  return labels[reason]
}
