import { Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { ExternalLink } from '~/components/ExternalLink'
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

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Team ${data?.team ?? 'Team'} - NDA` }]
}

export default function TeamPage({ loaderData: { team, appsByEnv } }: Route.ComponentProps) {
  const environments = Object.keys(appsByEnv).sort()

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="xlarge">
            {team}
          </Heading>
          <HStack gap="space-8" align="center">
            <ExternalLink href={`https://console.nav.cloud.nais.io/team/${team}/applications`}>
              NAIS Console
            </ExternalLink>
          </HStack>
        </VStack>

        <VStack gap="space-24">
          {environments.map((env) => (
            <VStack key={env} gap="space-16">
              <HStack gap="space-8" align="center">
                <Link to={`/team/${team}/env/${env}`} className="no-underline hover:underline">
                  <Heading level="2" size="small">
                    {env}
                  </Heading>
                </Link>
                <Tag size="xsmall" variant="neutral">
                  {appsByEnv[env].length} {appsByEnv[env].length === 1 ? 'applikasjon' : 'applikasjoner'}
                </Tag>
              </HStack>

              <div>
                {appsByEnv[env].map((app) => (
                  <AppCard key={app.id} app={app} showEnvironment={false} />
                ))}
              </div>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </Box>
  )
}
