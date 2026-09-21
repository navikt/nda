import { BodyShort, Box, Heading, Table, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getDeploymentsWithStatusChangesForApps } from '~/db/deployments.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { getFourEyesStatusLabel } from '~/lib/four-eyes-status'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import { formatChangeSource, getFourEyesStatus } from '~/lib/status-display'
import type { Route } from './+types/repository.$owner.$repo.admin.status-history'

export async function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/admin/status-history')

  const { authorized, affectedApps } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const appIds = affectedApps.map((app) => app.id)
  const deployments = await getDeploymentsWithStatusChangesForApps(appIds, repository.id)

  return {
    repositoryContext: {
      id: repository.id,
      githubOwner: repository.github_owner,
      githubRepoName: repository.github_repo_name,
    },
    deployments,
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Statusoverganger' }]
}

function getStatusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  return getFourEyesStatus({ four_eyes_status: status }).variant
}

export default function RepositoryStatusHistoryPage({ loaderData }: Route.ComponentProps) {
  const { repositoryContext, deployments } = loaderData

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="medium" spacing>
          Statusoverganger
        </Heading>
        <BodyShort textColor="subtle">
          Deployments i {repositoryContext.githubOwner}/{repositoryContext.githubRepoName} som har endret status mer enn
          én gang, på tvers av alle apper knyttet til repositoryet.
        </BodyShort>
      </div>

      {deployments.length === 0 ? (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen deployments med flere statusoverganger.
          </BodyShort>
        </Box>
      ) : (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Deployment</Table.HeaderCell>
              <Table.HeaderCell>App</Table.HeaderCell>
              <Table.HeaderCell>Gjeldende status</Table.HeaderCell>
              <Table.HeaderCell>Siste overgang</Table.HeaderCell>
              <Table.HeaderCell>Kilde</Table.HeaderCell>
              <Table.HeaderCell align="right">Antall</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {deployments.map((dep) => {
              const appUrl = `/team/${dep.team_slug}/env/${dep.environment_name}/app/${dep.app_name}`
              return (
                <Table.Row key={dep.deployment_id}>
                  <Table.DataCell>
                    <Link to={`${appUrl}/deployments/${dep.deployment_id}`}>
                      {dep.title || dep.commit_sha?.substring(0, 7) || `#${dep.deployment_id}`}
                    </Link>
                    <BodyShort size="small" textColor="subtle">
                      {new Date(dep.created_at).toLocaleDateString('no-NO')}
                    </BodyShort>
                  </Table.DataCell>
                  <Table.DataCell>
                    <BodyShort size="small">{dep.app_name}</BodyShort>
                    <BodyShort size="small" textColor="subtle">
                      {dep.team_slug} / {dep.environment_name}
                    </BodyShort>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Tag variant={getStatusVariant(dep.four_eyes_status)} size="xsmall">
                      {getFourEyesStatusLabel(dep.four_eyes_status)}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    {dep.latest_from_status && (
                      <>
                        <Tag variant={getStatusVariant(dep.latest_from_status)} size="xsmall">
                          {getFourEyesStatusLabel(dep.latest_from_status)}
                        </Tag>
                        {' → '}
                      </>
                    )}
                    <Tag variant={getStatusVariant(dep.latest_to_status)} size="xsmall">
                      {getFourEyesStatusLabel(dep.latest_to_status)}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Tag variant="neutral" size="xsmall">
                      {formatChangeSource(dep.latest_change_source)}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell align="right">{dep.transition_count}</Table.DataCell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}
