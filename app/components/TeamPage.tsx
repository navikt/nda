import { Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { ExternalLink } from '~/components/ExternalLink'

interface TeamPageProps {
  team: string
  appsByEnv: Record<string, AppCardData[]>
}

export function TeamPage({ team, appsByEnv }: TeamPageProps) {
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
