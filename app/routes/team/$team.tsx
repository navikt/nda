import type { AppCardData } from '~/components/AppCard'
import { TeamPage } from '~/components/TeamPage'
import { getAlertCountsByApp } from '~/db/alerts.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import { getApplicationsByTeam } from '~/db/monitored-applications.server'
import { groupAppsByEnvironment } from '~/lib/group-apps-by-environment'
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

  const appsByEnv = groupAppsByEnvironment(appsWithData)

  return {
    team,
    appsByEnv,
  }
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Team ${data?.team ?? 'Team'} - NDA` }]
}

export default function TeamPageRoute({ loaderData: { team, appsByEnv } }: Route.ComponentProps) {
  return <TeamPage team={team} appsByEnv={appsByEnv} />
}
