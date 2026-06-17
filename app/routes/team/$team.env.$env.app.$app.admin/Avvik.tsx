import { Link as AkselLink, BodyShort, Box, Heading, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']
export type AvvikProps = { app: LoaderData['app'] }

export function Avvik({ app }: AvvikProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Avvik
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Se og administrer registrerte avvik for deployments.
          </BodyShort>
        </div>
        <AkselLink
          as={Link}
          to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/deviations`}
        >
          Se avviksliste →
        </AkselLink>
      </VStack>
    </Box>
  )
}
