import type { AppCardData } from '~/components/AppCard'

export function groupAppsByEnvironment(apps: readonly AppCardData[]): Record<string, AppCardData[]> {
  return apps.reduce(
    (acc, app) => {
      if (!acc[app.environment_name]) {
        acc[app.environment_name] = []
      }
      acc[app.environment_name].push(app)
      return acc
    },
    {} as Record<string, AppCardData[]>,
  )
}
