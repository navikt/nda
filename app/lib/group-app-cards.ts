import type { AppCardData } from '~/components/AppCard'

interface AppWithGroup extends AppCardData {
  application_group_id?: number | null
}

export function groupAppCards(apps: AppWithGroup[], groupNames?: Map<number, string>): AppCardData[] {
  const grouped = new Map<number, AppWithGroup[]>()
  const ungrouped: AppCardData[] = []

  for (const app of apps) {
    if (app.application_group_id) {
      const existing = grouped.get(app.application_group_id)
      if (existing) {
        existing.push(app)
      } else {
        grouped.set(app.application_group_id, [app])
      }
    } else {
      ungrouped.push(app)
    }
  }

  const result: AppCardData[] = [...ungrouped]

  for (const [groupId, groupApps] of grouped) {
    if (groupApps.length === 1) {
      const single = groupApps[0]
      const name = groupNames?.get(groupId)
      if (name) {
        result.push({ ...single, groupName: name })
      } else {
        result.push(single)
      }
      continue
    }

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

    const name = groupNames?.get(groupId)

    result.push({
      ...primary,
      stats: mergedStats,
      alertCount: totalAlerts,
      siblingEnvironments: siblingEnvs,
      groupName: name,
      groupApps: allGroupApps,
    })
  }

  return result
}
