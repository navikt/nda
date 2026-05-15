import { Alert, BodyShort, Box, Detail, Heading, HStack, VStack } from '@navikt/ds-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import styles from '~/styles/common.module.css'

export type AdminUsersMapping = {
  github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

export type AdminUsersUnmappedUser = {
  github_username: string
  deployment_count: number
}

export type AdminUsersPageProps = {
  mappings: AdminUsersMapping[]
  unmappedUsers: AdminUsersUnmappedUser[]
  topActions?: ReactNode
  renderMappingActions?: (mapping: AdminUsersMapping) => ReactNode
  renderMappingDetails?: (mapping: AdminUsersMapping) => ReactNode
  renderUnmappedActions?: (user: AdminUsersUnmappedUser) => ReactNode
  children?: ReactNode
}

export function AdminUsersPage({
  mappings,
  unmappedUsers,
  topActions,
  renderMappingActions,
  renderMappingDetails,
  renderUnmappedActions,
  children,
}: AdminUsersPageProps) {
  return (
    <Box padding={{ xs: 'space-16', md: 'space-24' }}>
      <VStack gap="space-24">
        <HStack justify="space-between" align="center" wrap gap="space-8">
          <Heading level="1" size="large">
            Brukermappinger
          </Heading>
          {topActions}
        </HStack>

        <BodyShort textColor="subtle">
          Kobler GitHub-brukernavn til Nav-identitet og Slack for visning i deployment-oversikten.
        </BodyShort>

        {children}

        {unmappedUsers.length > 0 && (
          <Alert variant="warning">
            {unmappedUsers.length} GitHub-bruker{unmappedUsers.length === 1 ? '' : 'e'} har deployments men mangler
            mapping. Se listen nederst på siden.
          </Alert>
        )}

        {mappings.length === 0 ? (
          <Alert variant="info">
            Ingen brukermappinger er lagt til ennå. Klikk &quot;Legg til&quot; for å opprette den første.
          </Alert>
        ) : (
          <div>
            {mappings.map((mapping) => (
              <Box
                key={mapping.github_username}
                padding="space-16"
                background="raised"
                className={styles.stackedListItem}
              >
                <VStack gap="space-12">
                  <HStack gap="space-8" align="center" justify="space-between" wrap>
                    <Link to={`/users/${mapping.github_username}`} style={{ textDecoration: 'none' }}>
                      <Heading level="3" size="xsmall">
                        {mapping.display_name || mapping.github_username}
                      </Heading>
                    </Link>

                    {renderMappingActions ? <HStack gap="space-8">{renderMappingActions(mapping)}</HStack> : null}
                  </HStack>

                  <HStack gap="space-16" wrap>
                    <ExternalLink href={`https://github.com/${mapping.github_username}`}>
                      <Detail textColor="subtle">GitHub: {mapping.github_username}</Detail>
                    </ExternalLink>
                    {mapping.nav_email && <Detail textColor="subtle">{mapping.nav_email}</Detail>}
                    {mapping.nav_ident && (
                      <ExternalLink href={`https://teamkatalogen.nav.no/resource/${mapping.nav_ident}`}>
                        <Detail textColor="subtle">Teamkatalogen: {mapping.nav_ident}</Detail>
                      </ExternalLink>
                    )}
                    {mapping.slack_member_id && (
                      <ExternalLink href={`https://nav-it.slack.com/team/${mapping.slack_member_id}`}>
                        <Detail textColor="subtle">Slack: {mapping.slack_member_id}</Detail>
                      </ExternalLink>
                    )}
                    {!mapping.nav_email && !mapping.nav_ident && !mapping.slack_member_id && (
                      <Detail textColor="subtle">Ingen tilleggsinformasjon</Detail>
                    )}
                  </HStack>

                  {renderMappingDetails ? renderMappingDetails(mapping) : null}
                </VStack>
              </Box>
            ))}
          </div>
        )}

        {unmappedUsers.length > 0 && (
          <VStack gap="space-16">
            <Heading level="2" size="medium">
              GitHub-brukere uten mapping ({unmappedUsers.length})
            </Heading>
            <div>
              {unmappedUsers.map((user) => (
                <Box
                  key={user.github_username}
                  padding="space-16"
                  background="raised"
                  className={styles.stackedListItem}
                >
                  <HStack justify="space-between" align="center" gap="space-8" wrap>
                    <HStack gap="space-12" align="center">
                      <Link to={`/users/${user.github_username}`}>
                        <BodyShort weight="semibold">{user.github_username}</BodyShort>
                      </Link>
                      <Detail textColor="subtle">{user.deployment_count} deployments</Detail>
                    </HStack>
                    {renderUnmappedActions ? <HStack gap="space-8">{renderUnmappedActions(user)}</HStack> : null}
                  </HStack>
                </Box>
              ))}
            </div>
          </VStack>
        )}
      </VStack>
    </Box>
  )
}
