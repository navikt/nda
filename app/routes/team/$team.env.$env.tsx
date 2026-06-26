import { Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { ExternalLink } from '~/components/ExternalLink'
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

export default function TeamEnvPage() {
  const { team, env, apps } = useLoaderData<typeof loader>()

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="xlarge">
            {team} / {env}
          </Heading>
          <HStack gap="space-16" align="center">
            <Tag size="small" variant="neutral">
              {apps.length} {apps.length === 1 ? 'applikasjon' : 'applikasjoner'}
            </Tag>
            <ExternalLink href={`https://console.nav.cloud.nais.io/team/${team}/applications`}>
              NAIS Console
            </ExternalLink>
          </HStack>
        </VStack>

        <div>
          {apps.map((app) => (
            <AppCard key={app.id} app={app} showEnvironment={false} />
          ))}
        </div>
      </VStack>
    </Box>
  )
}
