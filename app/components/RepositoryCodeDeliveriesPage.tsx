import { Alert, BodyShort, Box, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import type { UnresolvedReason } from '~/db/repository-code-delivery-establishment.server'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import {
  UNRESOLVED_REASON_DESCRIPTIONS,
  UNRESOLVED_REASON_LABELS,
} from '~/lib/repository-code-delivery/unresolved-reasons'
import { PaginationControls } from './deployments'
import { ExternalLink } from './ExternalLink'

type DateValue = Date | string

export interface RepositoryCodeDeliveriesPageProps {
  repository: { id: number; githubOwner: string; githubRepoName: string }
  tracking: { enabled: boolean; since: DateValue | null }
  overview: {
    deliveryCount: number
    linkedDeploymentCount: number
    awaitingDeploymentCount: number
    unresolvedByReason: Partial<Record<UnresolvedReason, number>>
  }
  deliveries: {
    id: number
    base_sha: string
    head_sha: string
    created_at: DateValue
    is_anchor: boolean
    deployment_count: number
    app_names: string[]
  }[]
  unresolved: {
    deployment_id: number
    team_slug: string
    environment_name: string
    app_name: string
    commit_sha: string
    deployed_at: DateValue
    reason: UnresolvedReason
    first_seen_at: DateValue
    last_attempt_at: DateValue
  }[]
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

function CommitLink({ repository, sha }: { repository: { githubOwner: string; githubRepoName: string }; sha: string }) {
  return (
    <ExternalLink href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/commit/${sha}`}>
      <code>{sha.slice(0, 7)}</code>
    </ExternalLink>
  )
}

export function RepositoryCodeDeliveriesPage({
  repository,
  tracking,
  overview,
  deliveries,
  unresolved,
  page,
  totalPages,
  onPageChange,
}: RepositoryCodeDeliveriesPageProps) {
  const adminUrl = `/repository/${repository.githubOwner}/${repository.githubRepoName}/admin?repositoryId=${repository.id}`
  const unresolvedTotal = Object.values(overview.unresolvedByReason).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0,
  )
  const reasons = Object.entries(overview.unresolvedByReason) as [UnresolvedReason, number][]

  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="medium" spacing>
          Registrerte kodeleveranser
        </Heading>
        <BodyShort textColor="subtle">
          Pilotvisning for {repository.githubOwner}/{repository.githubRepoName}. Registreringen påvirker ikke
          godkjenning av deployments.
        </BodyShort>
      </div>

      {!tracking.enabled && (
        <Alert variant="info" size="small">
          Registreringen er av for dette repositoryet.
          {tracking.since ? ` Den var sist på fra ${formatAuditLogTimestamp(tracking.since)}.` : ''} Slå den på under
          admin for å begynne å registrere.
        </Alert>
      )}

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Sammendrag
          </Heading>
          <HStack gap="space-32" wrap>
            <div>
              <BodyShort size="small" textColor="subtle">
                Leveranser
              </BodyShort>
              <Heading size="medium" level="3">
                {overview.deliveryCount}
              </Heading>
            </div>
            <div>
              <BodyShort size="small" textColor="subtle">
                Koblede deployments
              </BodyShort>
              <Heading size="medium" level="3">
                {overview.linkedDeploymentCount}
              </Heading>
            </div>
            <div>
              <BodyShort size="small" textColor="subtle">
                Venter på vurdering
              </BodyShort>
              <Heading size="medium" level="3">
                {overview.awaitingDeploymentCount}
              </Heading>
            </div>
            <div>
              <BodyShort size="small" textColor="subtle">
                Uavklarte
              </BodyShort>
              <Heading size="medium" level="3">
                {unresolvedTotal}
              </Heading>
            </div>
          </HStack>
          {reasons.length > 0 && (
            <HStack gap="space-8" wrap>
              {reasons.map(([reason, count]) => (
                <Tag key={reason} data-color="warning" variant="outline" size="small">
                  {UNRESOLVED_REASON_LABELS[reason]}: {count}
                </Tag>
              ))}
            </HStack>
          )}
        </VStack>
      </Box>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Leveranser
          </Heading>
          {deliveries.length === 0 ? (
            <BodyShort textColor="subtle">Ingen leveranser er registrert ennå.</BodyShort>
          ) : (
            <Table size="small">
              <caption className="aksel-sr-only">Registrerte kodeleveranser for repositoryet</caption>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Opprettet</Table.HeaderCell>
                  <Table.HeaderCell>Fra</Table.HeaderCell>
                  <Table.HeaderCell>Til</Table.HeaderCell>
                  <Table.HeaderCell>Deployments</Table.HeaderCell>
                  <Table.HeaderCell>Apper</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {deliveries.map((delivery) => (
                  <Table.Row key={delivery.id}>
                    <Table.DataCell>{formatAuditLogTimestamp(delivery.created_at)}</Table.DataCell>
                    <Table.DataCell>
                      {delivery.is_anchor ? (
                        <Tag data-color="neutral" variant="outline" size="xsmall">
                          Anker
                        </Tag>
                      ) : (
                        <CommitLink repository={repository} sha={delivery.base_sha} />
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      <CommitLink repository={repository} sha={delivery.head_sha} />
                    </Table.DataCell>
                    <Table.DataCell>{delivery.deployment_count}</Table.DataCell>
                    <Table.DataCell>{delivery.app_names.join(', ') || '—'}</Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
          <PaginationControls page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </VStack>
      </Box>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Uavklarte deployments
          </Heading>
          {unresolved.length === 0 ? (
            <BodyShort textColor="subtle">Ingen uavklarte deployments.</BodyShort>
          ) : (
            <>
              {unresolvedTotal > unresolved.length && (
                <BodyShort size="small" textColor="subtle">
                  Viser de {unresolved.length} sist forsøkte av {unresolvedTotal}.
                </BodyShort>
              )}
              <Table size="small">
                <caption className="aksel-sr-only">Åpne uavklarte deployments for repositoryet</caption>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>App</Table.HeaderCell>
                    <Table.HeaderCell>Commit</Table.HeaderCell>
                    <Table.HeaderCell>Årsak</Table.HeaderCell>
                    <Table.HeaderCell>Første registrert</Table.HeaderCell>
                    <Table.HeaderCell>Siste forsøk</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {unresolved.map((item) => (
                    <Table.Row key={item.deployment_id}>
                      <Table.DataCell>
                        <Link
                          to={`/team/${item.team_slug}/env/${item.environment_name}/app/${item.app_name}/deployments/${item.deployment_id}`}
                        >
                          {item.app_name}
                        </Link>
                      </Table.DataCell>
                      <Table.DataCell>
                        <CommitLink repository={repository} sha={item.commit_sha} />
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{UNRESOLVED_REASON_LABELS[item.reason]}</BodyShort>
                        <BodyShort size="small" textColor="subtle">
                          {UNRESOLVED_REASON_DESCRIPTIONS[item.reason]}
                        </BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>{formatAuditLogTimestamp(item.first_seen_at)}</Table.DataCell>
                      <Table.DataCell>{formatAuditLogTimestamp(item.last_attempt_at)}</Table.DataCell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </>
          )}
        </VStack>
      </Box>

      <BodyShort size="small" textColor="subtle">
        <Link to={adminUrl}>← Tilbake til admin</Link>
      </BodyShort>
    </VStack>
  )
}
