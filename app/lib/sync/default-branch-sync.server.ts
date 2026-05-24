import { updateMonitoredApplication } from '~/db/monitored-applications.server'
import { getRepositoryDefaultBranch } from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'

/**
 * Cooldown between default_branch sync attempts (24h).
 *
 * Applies on both success and failure to avoid hammering the GitHub API for
 * deleted/inaccessible repos. If a misconfiguration is detected, an admin can
 * still update default_branch manually via the admin UI to bypass the cooldown.
 */
const DEFAULT_BRANCH_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000

interface SyncDefaultBranchInput {
  monitoredAppId: number
  appName: string
  currentDefaultBranch: string | null
  defaultBranchSyncedAt: Date | null
  owner: string
  repo: string
}

/**
 * Sync `monitored_applications.default_branch` from GitHub repo metadata.
 *
 * Does nothing if the last sync attempt was within DEFAULT_BRANCH_SYNC_COOLDOWN_MS.
 * Always updates `default_branch_synced_at` on every attempt (success AND
 * failure) so the cooldown is enforced uniformly. This prevents persistently
 * inaccessible repos (deleted, permission issues) from triggering a GitHub
 * `repos.get` call every 5-minute sync cycle.
 *
 * Safe to call multiple times concurrently — the worst case is duplicate work,
 * not data corruption (UPDATE is idempotent).
 */
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
    // GitHub fetch failed (deleted repo, permissions, transient API error).
    // Persist the attempt timestamp so the 24h cooldown applies on failures
    // too — otherwise a persistently broken repo would trigger a `repos.get`
    // call every 5-minute sync cycle and contribute to rate-limit pressure.
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
