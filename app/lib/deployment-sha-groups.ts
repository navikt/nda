export function groupDeploymentsBySha<T extends { id: number; commit_sha: string | null }>(
  deployments: T[],
): { key: string; sha: string | null; deployments: T[] }[] {
  const groups = new Map<string, { key: string; sha: string | null; deployments: T[] }>()
  for (const deployment of deployments) {
    const sha = deployment.commit_sha || null
    const key = sha ?? `deployment:${deployment.id}`
    const existing = groups.get(key)
    if (existing) {
      existing.deployments.push(deployment)
    } else {
      groups.set(key, { key, sha, deployments: [deployment] })
    }
  }
  return [...groups.values()]
}

import { isApprovedStatus, isNotApprovedStatus, isPendingStatus } from './four-eyes-status'

export function getDeploymentStatusSummary(deployments: { four_eyes_status: string }[]): string {
  let approved = 0
  let notApproved = 0
  let pending = 0
  let unrecognized = 0
  for (const deployment of deployments) {
    const status = deployment.four_eyes_status
    if (isApprovedStatus(status)) approved++
    else if (isNotApprovedStatus(status)) notApproved++
    else if (isPendingStatus(status)) pending++
    else unrecognized++
  }
  return [
    approved > 0 ? `${approved} godkjent${approved === 1 ? '' : 'e'}` : null,
    notApproved > 0 ? `${notApproved} ikke godkjent${notApproved === 1 ? '' : 'e'}` : null,
    pending > 0 ? `${pending} venter` : null,
    unrecognized > 0 ? `${unrecognized} med ukjent status` : null,
  ]
    .filter((label) => label !== null)
    .join(', ')
}
