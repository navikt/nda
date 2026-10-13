import { Alert, BodyShort, Heading, Link, Table, VStack } from '@navikt/ds-react'
import { Link as RouterLink, useLoaderData } from 'react-router'
import { getWorkflowRunRepositoryBackfillCoverage } from '~/db/workflow-run-repository-backfill-coverage.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/repository-id-backfill-coverage'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-ID backfill – admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const repositories = await getWorkflowRunRepositoryBackfillCoverage()
  const totals = repositories.reduce(
    (result, repository) => ({
      legacy: result.legacy + repository.totalLegacyDeployments,
      eligible: result.eligible + repository.eligible,
    }),
    { legacy: 0, eligible: 0 },
  )

  return { repositories, totals }
}

function formatPercent(value: number, total: number): string {
  return total === 0 ? '–' : `${Math.round((value / total) * 100)} %`
}

export default function RepositoryIdBackfillCoveragePage() {
  const { repositories, totals } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Dekning for repository-ID fra workflow runs
        </Heading>
        <BodyShort textColor="subtle">
          Skrivebeskyttet kartlegging av deployments uten repository-ID. Rapporten bruker bare lagrede workflow-run
          snapshots og gjør ingen GitHub-kall eller databaseendringer. Oversikten omfatter bare deployments som kan
          knyttes til et registrert repository via app-kobling og entydig owner/repo-navn.
        </BodyShort>
      </div>

      <Alert variant="info">
        Et deployment regnes som kandidat bare når workflow-run-snapshotet har samme repository-ID og head repository-ID
        som repositoryet, samme commit-SHA som deploymentet, og eventtypen er push. Kandidater blir ikke endret av denne
        rapporten.
      </Alert>

      <BodyShort>
        <strong>{totals.eligible.toLocaleString('no-NO')}</strong> av{' '}
        <strong>{totals.legacy.toLocaleString('no-NO')}</strong> deployments uten repository-ID er kandidater (
        {formatPercent(totals.eligible, totals.legacy)}).
      </BodyShort>

      {repositories.length === 0 ? (
        <BodyShort>Ingen eldre deployments uten repository-ID ble funnet for registrerte repositories.</BodyShort>
      ) : (
        <Table aria-label="Repository-ID-backfilldekning basert på workflow runs">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Repository</Table.HeaderCell>
              <Table.HeaderCell align="right">Uten ID i rapportens scope</Table.HeaderCell>
              <Table.HeaderCell align="right">Kandidater</Table.HeaderCell>
              <Table.HeaderCell align="right">Dekning</Table.HeaderCell>
              <Table.HeaderCell align="right">Mangler snapshot</Table.HeaderCell>
              <Table.HeaderCell>Andre årsaker</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {repositories.map((repository) => {
              const reasons = [
                `uten run-lenke ${repository.noTriggerUrl}`,
                `ugyldig lenke ${repository.invalidTriggerUrl}`,
                `URL-avvik ${repository.triggerUrlMismatch}`,
                `repository-ID-avvik ${repository.repositoryMismatch}`,
                `SHA-avvik ${repository.shaMismatch}`,
                `event ikke push ${repository.unsupportedEvent}`,
                `head-repo-avvik ${repository.headRepositoryMismatch}`,
              ]
              return (
                <Table.Row key={repository.repositoryId}>
                  <Table.DataCell>
                    <Link
                      as={RouterLink}
                      to={`/repository/${repository.githubOwner}/${repository.githubRepoName}/admin?repositoryId=${repository.repositoryId}`}
                    >
                      {repository.githubOwner}/{repository.githubRepoName}
                    </Link>
                  </Table.DataCell>
                  <Table.DataCell align="right">
                    {repository.totalLegacyDeployments.toLocaleString('no-NO')}
                  </Table.DataCell>
                  <Table.DataCell align="right">{repository.eligible.toLocaleString('no-NO')}</Table.DataCell>
                  <Table.DataCell align="right">
                    {formatPercent(repository.eligible, repository.totalLegacyDeployments)}
                  </Table.DataCell>
                  <Table.DataCell align="right">{repository.missingSnapshot.toLocaleString('no-NO')}</Table.DataCell>
                  <Table.DataCell>
                    <BodyShort size="small">{reasons.join('; ')}</BodyShort>
                  </Table.DataCell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}
