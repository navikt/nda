import { Link as AkselLink, Box, Heading, List, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import type { AffectedApp, Repository } from '~/db/repositories.server'

export interface RepositoryPageProps {
  repository: Repository
  affectedApps: AffectedApp[]
}

export function RepositoryPage({ repository, affectedApps }: RepositoryPageProps) {
  const repoFullName = `${repository.github_owner}/${repository.github_repo_name}`

  return (
    <VStack gap="space-24">
      <div>
        <Heading size="large" level="1">
          {repoFullName}
        </Heading>
        <ExternalLink href={`https://github.com/${repoFullName}`}>Se på GitHub</ExternalLink>
      </div>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Applikasjoner fra dette repoet
          </Heading>
          {affectedApps.length === 0 ? (
            <span>Ingen aktive applikasjoner er koblet til dette repoet.</span>
          ) : (
            <List>
              {affectedApps.map((app) => (
                <List.Item key={app.id}>
                  <AkselLink as={Link} to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`}>
                    {app.team_slug}/{app.app_name} ({app.environment_name})
                  </AkselLink>
                </List.Item>
              ))}
            </List>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
