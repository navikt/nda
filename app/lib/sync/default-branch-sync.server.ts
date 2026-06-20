import { updateMonitoredApplication } from '~/db/monitored-applications.server'
import { getRepositoryDefaultBranch } from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'

const DEFAULT_BRANCH_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000

interface SyncDefaultBranchInput {
  monitoredAppId: number
  appName: string
  currentDefaultBranch: string | null
  defaultBranchSyncedAt: Date | null
  owner: string
  repo: string
}

export async function syncDefaultBranchForApp(input: SyncDefaultBranchInput): Promise<void> {
  const { monitoredAppId, appName, currentDefaultBranch, defaultBranchSyncedAt, owner, repo } = input

  if (defaultBranchSyncedAt) {
    const elapsedMs = Date.now() - defaultBranchSyncedAt.getTime()
    if (elapsedMs < DEFAULT_BRANCH_SYNC_COOLDOWN_MS) {
      return
    }
  }

  const detectedDefaultBranch = await getRepositoryDefaultBranch(owner, repo)

  if (!detectedDefaultBranch) {
    logger.info(
      `🌿 default_branch sync skipped for ${appName} (${owner}/${repo}) — GitHub fetch failed; cooldown enforced, will retry in 24h`,
    )
    await updateMonitoredApplication(monitoredAppId, {
      default_branch_synced_at: new Date(),
    })
    return
  }

  if (detectedDefaultBranch === currentDefaultBranch) {
    await updateMonitoredApplication(monitoredAppId, {
      default_branch_synced_at: new Date(),
    })
    return
  }

  logger.info(
    `🌿 default_branch updated for ${appName} (${owner}/${repo}): "${currentDefaultBranch}" → "${detectedDefaultBranch}" (auto-detected from GitHub)`,
  )
  await updateMonitoredApplication(monitoredAppId, {
    default_branch: detectedDefaultBranch,
    default_branch_synced_at: new Date(),
  })
}
