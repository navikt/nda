import { Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { ExternalLink } from '~/components/ExternalLink'

export interface TeamEnvPageProps {
  team: string
  env: string
  apps: AppCardData[]
}

export function TeamEnvPage({ team, env, apps }: TeamEnvPageProps) {
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
