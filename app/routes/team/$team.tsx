import type { AppCardData } from '~/components/AppCard'
import { TeamPage } from '~/components/TeamPage'
import { getAlertCountsByApp } from '~/db/alerts.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import { getApplicationsByTeam } from '~/db/monitored-applications.server'
import type { Route } from './+types/$team'

export async function loader({ params: { team } }: Route.LoaderArgs) {
  const applications = await getApplicationsByTeam(team)

  if (applications.length === 0) {
    throw new Response('Team not found or has no monitored applications', { status: 404 })
  }

  const [alertCountsByApp, activeRepos, statsByApp] = await Promise.all([
    getAlertCountsByApp(),
    getAllActiveRepositories(),
    getAppDeploymentStatsBatch(applications.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year }))),
  ])

  const appsWithData: AppCardData[] = applications.map((app) => ({
    ...app,
    active_repo: activeRepos.get(app.id) || null,
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by getAppDeploymentStatsBatch
    stats: statsByApp.get(app.id)!,
    alertCount: alertCountsByApp.get(app.id) || 0,
  }))

  const appsByEnv = appsWithData.reduce(
    (acc, app) => {
      if (!acc[app.environment_name]) {
        acc[app.environment_name] = []
      }
      acc[app.environment_name].push(app)
      return acc
    },
    {} as Record<string, AppCardData[]>,
  )

  return {
    team,
    appsByEnv,
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Team ${data?.team ?? 'Team'} - NDA` }]
}

export default function TeamRoute({ loaderData }: Route.ComponentProps) {
  return <TeamPage {...loaderData} />
}
