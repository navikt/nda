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
