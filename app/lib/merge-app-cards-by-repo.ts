import type { AppCardData } from '~/components/AppCard'

export function mergeAppCardsByRepo(apps: AppCardData[]): AppCardData[] {
  const byRepoKey = new Map<string, AppCardData[]>()
  const ungrouped: AppCardData[] = []

  for (const app of apps) {
    if (app.active_repo) {
      const existing = byRepoKey.get(app.active_repo)
      if (existing) {
        existing.push(app)
      } else {
        byRepoKey.set(app.active_repo, [app])
      }
    } else {
      ungrouped.push(app)
    }
  }

  const result: AppCardData[] = [...ungrouped]

  for (const [repoKey, repoApps] of byRepoKey.entries()) {
    if (repoApps.length === 1) {
      result.push(repoApps[0])
      continue
    }

    result.push(mergeAppsIntoCard(repoApps, repoKey))
  }

  return result
}

function mergeAppsIntoCard(repoApps: AppCardData[], repoDisplayName: string): AppCardData {
  const primary = repoApps[0]
  const siblingEnvs = repoApps.slice(1).map((a) => a.environment_name)
  const repositoryIds = new Set(repoApps.map((app) => app.repository_id))
  const repositoryId =
    repoApps.every((app) => app.repository_id != null) && repositoryIds.size === 1 ? primary.repository_id : null

  const mergedStats = {
    total: repoApps.reduce((sum, a) => sum + a.stats.total, 0),
    without_four_eyes: repoApps.reduce((sum, a) => sum + a.stats.without_four_eyes, 0),
    pending_verification: repoApps.reduce((sum, a) => sum + a.stats.pending_verification, 0),
    missing_goal_links: repoApps.reduce((sum, a) => sum + (a.stats.missing_goal_links ?? 0), 0),
    unmapped_deployers: repoApps.reduce((sum, a) => sum + (a.stats.unmapped_deployers ?? 0), 0),
    baseline_action_count: repoApps.reduce((sum, a) => sum + (a.stats.baseline_action_count ?? 0), 0),
  }

  const totalAlerts = repoApps.reduce((sum, a) => sum + a.alertCount, 0)

  const allRepoApps = repoApps.map((a) => ({
    app_name: a.app_name,
    environment_name: a.environment_name,
  }))

  return {
    ...primary,
    stats: mergedStats,
    alertCount: totalAlerts,
    repository_id: repositoryId,
    siblingEnvironments: siblingEnvs,
    repoDisplayName,
    repoApps: allRepoApps,
  }
}
