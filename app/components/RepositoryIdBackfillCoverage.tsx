import { Alert, BodyShort, Button, Heading, HStack, Link, Select, Table, VStack } from '@navikt/ds-react'
import { Form, Link as RouterLink } from 'react-router'
import type { WorkflowRunRepositoryBackfillCoverage } from '~/db/workflow-run-repository-backfill-coverage.server'

interface RepositoryIdBackfillCoverageProps {
  teams: string[]
  selectedTeam: string | null
  invalidTeam: boolean
  repositories: WorkflowRunRepositoryBackfillCoverage[]
  totals: {
    legacy: number
    eligible: number
  }
}

function formatPercent(value: number, total: number): string {
  return total === 0 ? '–' : `${Math.round((value / total) * 100)} %`
}

export function RepositoryIdBackfillCoverage({
  teams,
  selectedTeam,
  invalidTeam,
  repositories,
  totals,
}: RepositoryIdBackfillCoverageProps) {
  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Dekning for repository-ID fra workflow runs
        </Heading>
        <BodyShort textColor="subtle">
          Skrivebeskyttet kartlegging av deployments uten repository-ID. Rapporten bruker bare lagrede workflow-run
          snapshots og gjør ingen GitHub-kall eller databaseendringer. Velg et Nais-team for å kjøre rapporten bare for
          teamets apper. Tallene gjelder dette teamet, ikke hele repositoryet på tvers av andre team.
        </BodyShort>
      </div>

      <Form method="get">
        <HStack gap="space-16" align="end" wrap>
          <Select label="Nais-team" name="team" defaultValue={selectedTeam ?? ''}>
            <option value="">Velg team</option>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </Select>
          <Button type="submit">Vis dekning</Button>
        </HStack>
      </Form>

      {invalidTeam && <Alert variant="warning">Ukjent Nais-team. Velg et team fra listen og prøv igjen.</Alert>}

      {selectedTeam ? (
        <>
          <Alert variant="info">
            Viser bare deployments for apper knyttet til Nais-teamet <strong>{selectedTeam}</strong>. Et deployment
            regnes som kandidat bare når workflow-run-snapshotet har samme repository-ID og head repository-ID som
            repositoryet, samme commit-SHA som deploymentet, og eventtypen er push. Kandidater blir ikke endret av denne
            rapporten.
          </Alert>

          <BodyShort>
            <strong>{totals.eligible.toLocaleString('no-NO')}</strong> av{' '}
            <strong>{totals.legacy.toLocaleString('no-NO')}</strong> deployments uten repository-ID er kandidater (
            {formatPercent(totals.eligible, totals.legacy)}).
          </BodyShort>

          {repositories.length === 0 ? (
            <BodyShort>
              Ingen eldre deployments uten repository-ID ble funnet for registrerte repositories knyttet til dette
              teamet.
            </BodyShort>
          ) : (
            <Table aria-label={`Repository-ID-backfilldekning for Nais-team ${selectedTeam}`}>
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
                      <Table.HeaderCell scope="row">
                        <Link
                          as={RouterLink}
                          to={`/repository/${repository.githubOwner}/${repository.githubRepoName}/admin?repositoryId=${repository.repositoryId}`}
                        >
                          {repository.githubOwner}/{repository.githubRepoName}
                        </Link>
                      </Table.HeaderCell>
                      <Table.DataCell align="right">
                        {repository.totalLegacyDeployments.toLocaleString('no-NO')}
                      </Table.DataCell>
                      <Table.DataCell align="right">{repository.eligible.toLocaleString('no-NO')}</Table.DataCell>
                      <Table.DataCell align="right">
                        {formatPercent(repository.eligible, repository.totalLegacyDeployments)}
                      </Table.DataCell>
                      <Table.DataCell align="right">
                        {repository.missingSnapshot.toLocaleString('no-NO')}
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{reasons.join('; ')}</BodyShort>
                      </Table.DataCell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          )}
        </>
      ) : (
        <BodyShort>Velg et Nais-team for å hente rapporten.</BodyShort>
      )}
    </VStack>
  )
}
