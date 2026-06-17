import { Link as AkselLink, BodyShort, Box, Heading, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']
export type ReverifiseringProps = { app: LoaderData['app'] }

export function Reverifisering({ app }: ReverifiseringProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Reverifisering
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Sammenlign cached data med gjeldende verifiseringslogikk. Avvik kan godkjennes enkeltvis.
          </BodyShort>
        </div>
        <AkselLink
          as={Link}
          to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/verification-diff`}
        >
          Se verifiseringsavvik →
        </AkselLink>
        <AkselLink
          as={Link}
          to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/status-history`}
        >
          Se statusoverganger →
        </AkselLink>
        <AkselLink
          as={Link}
          to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/sync-jobs`}
        >
          Se synk-jobber →
        </AkselLink>
      </VStack>
    </Box>
  )
}
