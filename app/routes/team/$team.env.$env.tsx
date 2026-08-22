import { useLoaderData } from 'react-router'
import type { AppCardData } from '~/components/AppCard'
import { TeamEnvPage } from '~/components/TeamEnvPage'
import { getAlertCountsByApp } from '~/db/alerts.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import { getApplicationsByTeamAndEnv } from '~/db/monitored-applications.server'
import { requireTeamEnvParams } from '~/lib/route-params.server'
import type { Route } from './+types/$team.env.$env'

export async function loader({ params }: Route.LoaderArgs) {
  const { team, env } = requireTeamEnvParams(params)

  const applications = await getApplicationsByTeamAndEnv(team, env)

  if (applications.length === 0) {
    throw new Response('Team/environment not found or has no monitored applications', { status: 404 })
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

  return {
    team,
    env,
    apps: appsWithData,
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `${data?.team ?? 'Team'} / ${data?.env ?? 'Env'} - NDA` }]
}

export default function TeamEnvRoute() {
  const loaderData = useLoaderData<typeof loader>()

  return <TeamEnvPage {...loaderData} />
}
