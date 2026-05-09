import { isApprovedStatus, PENDING_STATUSES } from '~/lib/four-eyes-status'

/**
 * Pure filtering/sorting logic extracted from verifyDeploymentsFourEyes.
 * Determines which deployments need verification and in what order.
 */

interface DeploymentForFilter {
  id: number
  four_eyes_status: string | null
  created_at: string | Date
  commit_sha: string | null
}

/**
 * Filter deployments to only those that need verification.
 * Matches the logic in verifyDeploymentsFourEyes:
 * - Must not already be approved
 * - Must not be 'legacy' status
 * - Must have a pending or error status
 */
export function filterDeploymentsForVerification<T extends DeploymentForFilter>(deployments: T[]): T[] {
  const statusesToVerify = [...PENDING_STATUSES, 'error']
  return deployments.filter(
    (d) =>
      !isApprovedStatus(d.four_eyes_status ?? '') &&
      d.four_eyes_status !== 'legacy' &&
      statusesToVerify.includes(d.four_eyes_status ?? ''),
  )
}

/**
 * Sort deployments by created_at ascending (oldest first).
 * Returns a new sorted array.
 */
export function sortDeploymentsByAge<T extends DeploymentForFilter>(deployments: T[]): T[] {
  return [...deployments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

/**
 * Apply limit to deployments array.
 */
export function applyLimit<T>(deployments: T[], limit?: number): T[] {
  return limit ? deployments.slice(0, limit) : deployments
}

/**
 * Classify a deployment's commit SHA for verification.
 * Returns the action to take.
 */
export function classifyCommitSha(commitSha: string | null): 'verify' | 'skip_no_sha' | 'mark_legacy' {
  if (!commitSha) return 'skip_no_sha'
  if (commitSha.startsWith('refs/')) return 'mark_legacy'
  return 'verify'
}
