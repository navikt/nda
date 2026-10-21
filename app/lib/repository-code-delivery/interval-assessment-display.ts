import type { RepositoryDeliveryCommitAssessmentReason } from './interval-assessment'

export function assessmentReasonLabel(reason: RepositoryDeliveryCommitAssessmentReason): string {
  const labels: Record<RepositoryDeliveryCommitAssessmentReason, string> = {
    approved_review: 'Godkjent review etter siste relevante commit',
    implicit_approval: 'Oppfyller konfigurert implisitt godkjenning',
    no_associated_pull_request: 'Lagret koblingssnapshot viser ingen tilknyttet PR',
    no_default_branch_pull_request: 'Ingen tilknyttet PR mot repositoryets default-branch',
    no_approved_reviews: 'Ingen godkjent review i snapshotten',
    no_pull_request_commits: 'PR-snapshotten inneholder ingen commits',
    approval_before_last_commit: 'Godkjenningen kom før siste commit i PR-en',
    self_approval: 'Siste godkjenning kom fra siste commit-forfatter',
    unlinked_commit_author: 'Siste commit-forfatter kan ikke knyttes til en GitHub-bruker',
    missing_associated_pull_request_snapshot: 'Snapshot for PR-kobling mangler eller er uleselig',
    missing_pull_request_snapshot: 'Snapshot av PR, commits eller reviews mangler',
    incomplete_pull_request_snapshot: 'PR-snapshotten er ufullstendig eller har feil branch',
    pull_request_head_mismatch: 'PR-head samsvarer ikke med siste commit i snapshotten',
    incomplete_stack_evidence: 'Snapshottene beviser ikke om den stablede PR-en nådde default-branch',
    commit_not_in_pull_request: 'Committen finnes ikke i PR-snapshotten',
    unknown_default_branch: 'Repositoryets default-branch er ukjent',
    invalid_comparison_range: 'Sammenligningen viser ikke et gyldig base..head-intervall',
  }
  return labels[reason]
}
