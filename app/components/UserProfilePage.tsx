import { PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'

interface UserProfileMapping {
  github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

interface UserProfileDeployment {
  id: number
  app_name: string
  environment_name: string
  team_slug: string
  created_at: string
}

interface UserProfilePageProps {
  username: string
  mapping: UserProfileMapping | null
  deploymentCount: number
  recentDeployments: UserProfileDeployment[]
}

const dateFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
} as const

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('nb-NO', dateFormatOptions)
}

export function UserProfilePage({ username, mapping, deploymentCount, recentDeployments }: UserProfilePageProps) {
  return (
    <VStack gap="space-32">
      <VStack gap="space-8">
        <Heading level="1" size="large">
          {mapping?.display_name || username}
        </Heading>
      </VStack>

      <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
        <Box padding="space-16" borderRadius="8" background="sunken">
          <VStack gap="space-4">
            <Detail textColor="subtle">GitHub</Detail>
            <ExternalLink href={`https://github.com/${username}`}>{username}</ExternalLink>
          </VStack>
        </Box>

        {mapping?.nav_email && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">E-post</Detail>
              <BodyShort>{mapping.nav_email}</BodyShort>
            </VStack>
          </Box>
        )}

        {mapping?.nav_ident && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Teamkatalogen</Detail>
              <ExternalLink href={`https://teamkatalogen.nav.no/resource/${mapping.nav_ident}`}>
                {mapping.nav_ident}
              </ExternalLink>
            </VStack>
          </Box>
        )}

        {mapping?.slack_member_id && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Slack</Detail>
              <ExternalLink href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`}>
                Åpne i Slack
              </ExternalLink>
            </VStack>
          </Box>
        )}
      </HGrid>

      {!mapping && (
        <Alert variant="warning">
          <HStack gap="space-16" align="center" justify="space-between" wrap>
            <BodyShort>Ingen brukermapping funnet for denne brukeren.</BodyShort>
            <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />}>
              Opprett mapping
            </Button>
          </HStack>
        </Alert>
      )}

      <VStack gap="space-16">
        <Heading level="2" size="small">
          Siste deployments ({deploymentCount})
        </Heading>

        {recentDeployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet for denne brukeren.</BodyShort>
          </Box>
        ) : (
          <div>
            {recentDeployments.map((deployment) => (
              <Box
                key={deployment.id}
                padding="space-16"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
                style={{ marginBottom: '-1px' }}
              >
                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  <HStack gap="space-12" align="center">
                    <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(deployment.created_at)}
                    </BodyShort>
                    <Link
                      to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}`}
                    >
                      <BodyShort>{deployment.app_name}</BodyShort>
                    </Link>
                  </HStack>
                  <Detail textColor="subtle">{deployment.environment_name}</Detail>
                </HStack>
              </Box>
            ))}
          </div>
        )}
      </VStack>
    </VStack>
  )
}
