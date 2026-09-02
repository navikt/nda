import type { AppCardData } from '~/components/AppCard'

export function groupAppCardsByRepo(apps: AppCardData[]): AppCardData[] {
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

  for (const repoApps of byRepoKey.values()) {
    if (repoApps.length === 1) {
      result.push(repoApps[0])
      continue
    }

    result.push(mergeAppsIntoCard(repoApps))
  }

  return result
}

function mergeAppsIntoCard(groupApps: AppCardData[], groupName?: string): AppCardData {
  const primary = groupApps[0]
  const siblingEnvs = groupApps.slice(1).map((a) => a.environment_name)

  const mergedStats = {
    total: groupApps.reduce((sum, a) => sum + a.stats.total, 0),
    without_four_eyes: groupApps.reduce((sum, a) => sum + a.stats.without_four_eyes, 0),
    pending_verification: groupApps.reduce((sum, a) => sum + a.stats.pending_verification, 0),
    missing_goal_links: groupApps.reduce((sum, a) => sum + (a.stats.missing_goal_links ?? 0), 0),
    unmapped_deployers: groupApps.reduce((sum, a) => sum + (a.stats.unmapped_deployers ?? 0), 0),
    baseline_action_count: groupApps.reduce((sum, a) => sum + (a.stats.baseline_action_count ?? 0), 0),
  }

  const totalAlerts = groupApps.reduce((sum, a) => sum + a.alertCount, 0)

  const allGroupApps = groupApps.map((a) => ({
    app_name: a.app_name,
    environment_name: a.environment_name,
  }))

  return {
    ...primary,
    stats: mergedStats,
    alertCount: totalAlerts,
    siblingEnvironments: siblingEnvs,
    groupName,
    groupApps: allGroupApps,
  }
}
