import { Link as AkselLink, BodyShort, Heading, HStack, Table, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'

export interface RepositoryApprovalDeliveriesPageProps {
  repository: { id: number; githubOwner: string; githubRepoName: string }
  deliveries: Array<{ id: number; baseSha: string; headSha: string; firstDeployedAt: Date | string | null }>
  page: number
  hasNextPage: boolean
}

export function RepositoryApprovalDeliveriesPage({
  repository,
  deliveries,
  page,
  hasNextPage,
}: RepositoryApprovalDeliveriesPageProps) {
  const basePath = `/repository/${repository.githubOwner}/${repository.githubRepoName}`
  return (
    <VStack gap="space-24">
      <Heading level="1" size="large">
        Leveranser til manuell godkjenning · {repository.githubOwner}/{repository.githubRepoName}
      </Heading>
      <AkselLink as={Link} to={`${basePath}?repositoryId=${repository.id}`}>
        Til repositoryet
      </AkselLink>
      <BodyShort>
        Velg en leveranse for å gjennomgå et fryst grunnlag. Manuelle godkjenninger endrer ikke deploymentstatus.
      </BodyShort>
      {deliveries.length === 0 ? (
        <BodyShort>Ingen repositoryleveranser er registrert.</BodyShort>
      ) : (
        <Table>
          <caption>Repositoryleveranser · side {page}</caption>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Intervall</Table.HeaderCell>
              <Table.HeaderCell>Første deployment</Table.HeaderCell>
              <Table.HeaderCell>Gjennomgang</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {deliveries.map((delivery) => (
              <Table.Row key={delivery.id}>
                <Table.DataCell>
                  <code>{delivery.baseSha}</code> → <code>{delivery.headSha}</code>
                </Table.DataCell>
                <Table.DataCell>
                  {delivery.firstDeployedAt ? formatAuditLogTimestamp(delivery.firstDeployedAt) : 'Ikke deployet'}
                </Table.DataCell>
                <Table.DataCell>
                  <AkselLink as={Link} to={`${basePath}/approvals/${delivery.id}?repositoryId=${repository.id}`}>
                    Åpne leveranse {delivery.id}
                  </AkselLink>
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      <HStack gap="space-16">
        {page > 1 && (
          <AkselLink as={Link} to={`?repositoryId=${repository.id}&page=${page - 1}`}>
            Forrige side
          </AkselLink>
        )}
        {hasNextPage && (
          <AkselLink as={Link} to={`?repositoryId=${repository.id}&page=${page + 1}`}>
            Neste side
          </AkselLink>
        )}
      </HStack>
    </VStack>
  )
}
