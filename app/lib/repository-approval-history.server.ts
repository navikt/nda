import type { ManualApprovalHistoryEntry } from '~/components/RepositoryManualApprovalHistory'
import type { getRepositoryManualApprovalHistory } from '~/db/repository-manual-approvals.server'

export function presentRepositoryApprovalHistory(
  history: Omit<Awaited<ReturnType<typeof getRepositoryManualApprovalHistory>>, 'snapshots'> & {
    snapshots: { id: number; base_sha: string; head_sha: string }[]
  },
): ManualApprovalHistoryEntry[] {
  return [...new Set(history.commits.map((commit) => commit.id))].map((id) => {
    const commits = history.commits.filter((commit) => commit.id === id)
    const approval = commits[0]
    const snapshot = history.snapshots.find((snapshot) => snapshot.id === approval.snapshot_id)
    if (!snapshot) throw new Error(`Missing snapshot for manual approval ${id}`)
    return {
      id,
      reviewer: approval.reviewer_nav_ident,
      registeredBy: approval.registered_by_nav_ident,
      reviewedAt: approval.reviewed_at,
      registeredAt: approval.registered_at,
      reviewDocumentation: approval.review_documentation ?? null,
      baseSha: snapshot.base_sha,
      headSha: snapshot.head_sha,
      commits: commits.map((commit) => ({
        sha: commit.sha,
        authorLogin: commit.author_login,
        authorNavIdent: commit.author_nav_ident,
        status: commit.status,
      })),
      events: history.events
        .filter((event) => event.approval_id === id)
        .map((event) => ({
          type: event.event_type,
          actor: event.actor_nav_ident,
          reason: event.reason,
          at: event.created_at,
        })),
    }
  })
}
