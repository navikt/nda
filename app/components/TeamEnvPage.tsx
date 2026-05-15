import { Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { AppCard, type AppCardData } from './AppCard'

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
            {team}
          </Heading>
          <HStack gap="space-8" align="center">
            <Tag variant="neutral" size="small">
              {env}
            </Tag>
            <Tag variant="neutral-moderate" size="xsmall">
              {apps.length} {apps.length === 1 ? 'applikasjon' : 'applikasjoner'}
            </Tag>
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
