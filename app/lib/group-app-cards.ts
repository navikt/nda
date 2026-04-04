import type { AppCardData } from '~/components/AppCard'

interface AppWithGroup extends AppCardData {
  application_group_id?: number | null
}

/**
 * Group app cards by application_group_id.
 * Apps in the same group are merged into a single card with aggregated stats
 * and a list of sibling environments.
 * Apps without a group are returned as-is.
 */
export function groupAppCards(apps: AppWithGroup[]): AppCardData[] {
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

  for (const [, groupApps] of grouped) {
    if (groupApps.length === 1) {
      result.push(groupApps[0])
      continue
    }

    // Use the first app as the "primary" — merge stats from siblings
    const primary = groupApps[0]
    const siblingEnvs = groupApps.slice(1).map((a) => a.environment_name)

    const mergedStats = {
      total: groupApps.reduce((sum, a) => sum + a.stats.total, 0),
      without_four_eyes: groupApps.reduce((sum, a) => sum + a.stats.without_four_eyes, 0),
      pending_verification: groupApps.reduce((sum, a) => sum + a.stats.pending_verification, 0),
    }

    const totalAlerts = groupApps.reduce((sum, a) => sum + a.alertCount, 0)

    result.push({
      ...primary,
      stats: mergedStats,
      alertCount: totalAlerts,
      siblingEnvironments: siblingEnvs,
    })
  }

  return result
}
