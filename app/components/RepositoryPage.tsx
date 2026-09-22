import { BarChartIcon, CogIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, Box, Button, Heading, HGrid, HStack, List, Select, VStack } from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { StatCard } from '~/components/StatCard'
import type { AppDeploymentStats } from '~/db/deployments.server'
import { TIME_PERIOD_OPTIONS, type TimePeriod } from '~/lib/time-periods'

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
  deploymentStats: AppDeploymentStats
  period: TimePeriod
}

export function RepositoryPage({
  repository,
  affectedApps,
  canAccessAdmin,
  deploymentStats,
  period,
}: RepositoryPageProps) {
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
        <VStack gap="space-20">
          <HStack justify="space-between" align="center" wrap>
            <Heading level="2" size="medium">
              <BarChartIcon aria-hidden /> Statistikk
            </Heading>
            <Form method="get" onChange={(e) => e.currentTarget.submit()}>
              <input type="hidden" name="repositoryId" value={repository.id} />
              <Select label="Tidsperiode" name="period" defaultValue={period} size="small" hideLabel>
                {TIME_PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Form>
          </HStack>
          <HGrid gap="space-16" columns={{ xs: 2, md: 3, lg: 5 }}>
            <StatCard
              label="Totalt deployments"
              value={deploymentStats.total}
              to={`${deploymentsUrl}&period=${period}`}
              compact
            />
            <StatCard
              label="Godkjent"
              value={`${deploymentStats.with_four_eyes} (${deploymentStats.four_eyes_percentage}%)`}
              variant="success"
              to={`${deploymentsUrl}&status=approved&period=${period}`}
              compact
            />
            <StatCard
              label="Mangler godkjenning"
              value={deploymentStats.without_four_eyes}
              variant="danger"
              to={`${deploymentsUrl}&status=not_approved&period=${period}`}
              compact
            />
            <StatCard
              label="Venter verifisering"
              value={deploymentStats.pending_verification}
              variant="warning"
              to={`${deploymentsUrl}&status=pending&period=${period}`}
              compact
            />
            {deploymentStats.last_deployment_id && deploymentStats.last_deployment ? (
              <StatCard
                label="Siste deployment"
                value={new Date(deploymentStats.last_deployment).toLocaleString('no-NO')}
                to={`${deploymentsUrl}&period=${period}`}
                compact
              />
            ) : (
              <StatCard label="Siste deployment" value="Ingen deployments" compact />
            )}
          </HGrid>
        </VStack>
      </Box>

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
