import { BodyShort, Box, Detail, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import { ExternalLink } from './ExternalLink'

interface UserProfileIdentity {
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

interface UserProfileHeaderProps {
  username: string
  githubUsername?: string | null
  displayName?: string | null
  identity?: UserProfileIdentity | null
  isBot?: boolean
  botDescription?: string | null
}

export function UserProfileHeader({
  username,
  githubUsername,
  displayName,
  identity,
  isBot,
  botDescription,
}: UserProfileHeaderProps) {
  return (
    <>
      <VStack gap="space-8">
        <HStack gap="space-12" align="center">
          <Heading level="1" size="large">
            {displayName || username}
          </Heading>
          {isBot && (
            <Tag variant="neutral" size="small">
              Bot
            </Tag>
          )}
        </HStack>
        {isBot && botDescription && <BodyShort textColor="subtle">{botDescription}</BodyShort>}
      </VStack>

      <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
        {(isBot || githubUsername) && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">GitHub</Detail>
              <ExternalLink href={`https://github.com/${githubUsername ?? username}`}>
                {githubUsername ?? username}
              </ExternalLink>
            </VStack>
          </Box>
        )}

        {identity?.nav_email && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">E-post</Detail>
              <BodyShort>{identity.nav_email}</BodyShort>
            </VStack>
          </Box>
        )}

        {identity?.nav_ident && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Teamkatalogen</Detail>
              <ExternalLink href={`https://teamkatalogen.nav.no/resource/${identity.nav_ident}`}>
                {identity.nav_ident}
              </ExternalLink>
            </VStack>
          </Box>
        )}

        {identity?.slack_member_id && (
          <Box padding="space-16" borderRadius="8" background="sunken">
            <VStack gap="space-4">
              <Detail textColor="subtle">Slack</Detail>
              <ExternalLink href={`https://nav-it.slack.com/team/${identity.slack_member_id}`}>
                Åpne i Slack
              </ExternalLink>
            </VStack>
          </Box>
        )}
      </HGrid>
    </>
  )
}
