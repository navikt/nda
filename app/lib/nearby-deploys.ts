export interface NearbyDeploy {
  id: number
  commit_sha: string | null
  created_at: string | Date
  four_eyes_status: string
  deployer_username: string | null
}

interface NearbyDeployWithCurrent extends NearbyDeploy {
  isCurrent: boolean
}

export function mergeWithCurrentDeploy(
  nearbyDeployments: NearbyDeploy[],
  currentDeploy: NearbyDeploy,
): NearbyDeployWithCurrent[] {
  return [...nearbyDeployments.map((nd) => ({ ...nd, isCurrent: false })), { ...currentDeploy, isCurrent: true }].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}
