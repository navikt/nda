import { isApprovedStatus, REVERIFIABLE_STATUSES } from '~/lib/four-eyes-status'

interface DeploymentForFilter {
  id: number
  four_eyes_status: string | null
  created_at: string | Date
  commit_sha: string | null
}

export function filterDeploymentsForVerification<T extends DeploymentForFilter>(deployments: T[]): T[] {
  const statusesToVerify = [...REVERIFIABLE_STATUSES, 'error']
  return deployments.filter(
    (d) =>
      !isApprovedStatus(d.four_eyes_status ?? '') &&
      d.four_eyes_status !== 'legacy' &&
      statusesToVerify.includes(d.four_eyes_status ?? ''),
  )
}

export function sortDeploymentsByAge<T extends DeploymentForFilter>(deployments: T[]): T[] {
  return [...deployments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

export function applyLimit<T>(deployments: T[], limit?: number): T[] {
  return limit ? deployments.slice(0, limit) : deployments
}

export function classifyCommitSha(commitSha: string | null): 'verify' | 'skip_no_sha' | 'mark_legacy' {
  if (!commitSha) return 'skip_no_sha'
  if (commitSha.startsWith('refs/')) return 'mark_legacy'
  return 'verify'
}
