import { CogIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, Box, Button, Heading, HStack, List, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'

export interface RepositoryPageRepository {
  id: number
  github_owner: string
  github_repo_name: string
}

export interface RepositoryPageAffectedApp {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
}

export interface RepositoryPageProps {
  repository: RepositoryPageRepository
  affectedApps: RepositoryPageAffectedApp[]
  canAccessAdmin: boolean
}

export function RepositoryPage({ repository, affectedApps, canAccessAdmin }: RepositoryPageProps) {
  const repoFullName = `${repository.github_owner}/${repository.github_repo_name}`
  const adminUrl = `/repository/${repository.github_owner}/${repository.github_repo_name}/admin?repositoryId=${repository.id}`
  const deploymentsUrl = `/repository/${repository.github_owner}/${repository.github_repo_name}/deployments?repositoryId=${repository.id}`

  return (
    <VStack gap="space-24">
      <HStack justify="space-between" align="start" wrap>
        <div>
          <Heading size="large" level="1">
            {repoFullName}
          </Heading>
          <HStack gap="space-16">
            <ExternalLink href={`https://github.com/${repoFullName}`}>Se på GitHub</ExternalLink>
            <AkselLink as={Link} to={deploymentsUrl}>
              Se alle deployments for repoet
            </AkselLink>
          </HStack>
        </div>
        {canAccessAdmin && (
          <Button as={Link} to={adminUrl} variant="tertiary" size="small" icon={<CogIcon aria-hidden />}>
            Administrer
          </Button>
        )}
      </HStack>

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
