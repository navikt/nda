import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Heading,
  HStack,
  type SortState,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
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
  historyReadiness: {
    applications: {
      team_slug: string
      environment_name: string
      app_name: string
      is_active: boolean
      initial_nais_history_synced_at: DateValue | null
      deployment_count: number
      repository_deployment_count: number
      unassigned_deployment_count: number
      other_repository_deployment_count: number
      repository_deployments_missing_sha: number
    }[]
    repositoryDeploymentCount: number
    repositoryDeploymentsMissingShaCount: number
    repositoryDeploymentsWithoutKnownAppLinkCount: number
  }
  deliveries: {
    id: number
    base_sha: string
    head_sha: string
    created_at: DateValue
    first_deployed_at: DateValue | null
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
    detected_github_owner: string | null
    detected_github_repo_name: string | null
    deployed_at: DateValue
    reason: UnresolvedReason
    first_seen_at: DateValue
    last_attempt_at: DateValue
  }[]
  page: number
  totalPages: number
  sort?: SortState
  onPageChange: (page: number) => void
  onSortChange: (sortKey: string) => void
}

function CommitLink({
  repository,
  sha,
}: {
  repository: { githubOwner: string | null; githubRepoName: string | null }
  sha: string
}) {
  if (!repository.githubOwner || !repository.githubRepoName) {
    return <code>{sha.slice(0, 7)}</code>
  }
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
  historyReadiness,
  deliveries,
  unresolved,
  page,
  totalPages,
  sort,
  onPageChange,
  onSortChange,
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
          {tracking.since ? ` Den ble første gang slått på ${formatAuditLogTimestamp(tracking.since)}.` : ''} Slå den på
          under admin for å {tracking.since ? 'fortsette' : 'begynne'} å registrere.
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
              <BodyShort weight="semibold" size="large">
                {overview.deliveryCount}
              </BodyShort>
            </div>
            <div>
              <BodyShort size="small" textColor="subtle">
                Koblede deployments
              </BodyShort>
              <BodyShort weight="semibold" size="large">
                {overview.linkedDeploymentCount}
              </BodyShort>
            </div>
            <div>
              <BodyShort size="small" textColor="subtle">
                Venter på vurdering
              </BodyShort>
              <BodyShort weight="semibold" size="large">
                {overview.awaitingDeploymentCount}
              </BodyShort>
            </div>
            <div>
              <BodyShort size="small" textColor="subtle">
                Uavklarte
              </BodyShort>
              <BodyShort weight="semibold" size="large">
                {unresolvedTotal}
              </BodyShort>
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
          <div>
            <Heading size="small" level="2">
              Grunnlag for historisk innlesing
            </Heading>
            <BodyShort size="small" textColor="subtle">
              Viser apper med aktiv eller historisk kobling via stabil GitHub repository-ID. Manglende repository-ID på
              en app-deployment betyr ikke i seg selv at den tilhører dette repositoryet. Navnebaserte historiske
              koblinger uten stabil ID vises ikke og må avklares separat.
            </BodyShort>
          </div>
          <BodyShort size="small">
            {historyReadiness.applications.filter((app) => app.initial_nais_history_synced_at !== null).length} av{' '}
            {historyReadiness.applications.length} kjente apper har markert fullført initial Nais-historikksynk. Dette
            bekrefter ikke alene at repositorykoblinger og Git-ancestry er komplette eller entydige.
          </BodyShort>
          <BodyShort size="small">
            {historyReadiness.repositoryDeploymentCount} deployments har stabil repository-ID;{' '}
            {historyReadiness.repositoryDeploymentsMissingShaCount} av disse mangler full commit-SHA, og{' '}
            {historyReadiness.repositoryDeploymentsWithoutKnownAppLinkCount} kommer fra apper uten en kjent aktiv eller
            historisk kobling med denne repository-ID-en.
          </BodyShort>
          {historyReadiness.applications.length === 0 ? (
            <BodyShort textColor="subtle">Ingen apper med stabil repository-ID-kobling er funnet.</BodyShort>
          ) : (
            <Table size="small">
              <caption className="aksel-sr-only">Historikksynk og deploymentdekning per repositorykoblet app</caption>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>App</Table.HeaderCell>
                  <Table.HeaderCell>Initial Nais-historikksynk</Table.HeaderCell>
                  <Table.HeaderCell>Alle deployments</Table.HeaderCell>
                  <Table.HeaderCell>Med repository-ID</Table.HeaderCell>
                  <Table.HeaderCell>Uten repository-ID</Table.HeaderCell>
                  <Table.HeaderCell>Andre repository-ID-er</Table.HeaderCell>
                  <Table.HeaderCell>Repo-deployments uten full SHA</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {historyReadiness.applications.map((app) => (
                  <Table.Row key={`${app.team_slug}/${app.environment_name}/${app.app_name}`}>
                    <Table.HeaderCell scope="row">
                      {app.app_name}
                      {!app.is_active && (
                        <BodyShort size="small" textColor="subtle">
                          Inaktiv
                        </BodyShort>
                      )}
                      <BodyShort size="small" textColor="subtle">
                        {app.team_slug} · {app.environment_name}
                      </BodyShort>
                    </Table.HeaderCell>
                    <Table.DataCell>
                      {app.initial_nais_history_synced_at
                        ? formatAuditLogTimestamp(app.initial_nais_history_synced_at)
                        : 'Ikke markert fullført'}
                    </Table.DataCell>
                    <Table.DataCell>{app.deployment_count}</Table.DataCell>
                    <Table.DataCell>{app.repository_deployment_count}</Table.DataCell>
                    <Table.DataCell>{app.unassigned_deployment_count}</Table.DataCell>
                    <Table.DataCell>{app.other_repository_deployment_count}</Table.DataCell>
                    <Table.DataCell>{app.repository_deployments_missing_sha}</Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
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
            <Table size="small" sort={sort} onSortChange={onSortChange}>
              <caption className="aksel-sr-only">Registrerte kodeleveranser for repositoryet</caption>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader sortKey="first_deployed_at" sortable>
                    Første deployment
                  </Table.ColumnHeader>
                  <Table.ColumnHeader sortKey="created_at" sortable>
                    Registrert
                  </Table.ColumnHeader>
                  <Table.ColumnHeader sortKey="base_sha" sortable>
                    Fra
                  </Table.ColumnHeader>
                  <Table.ColumnHeader sortKey="head_sha" sortable>
                    Til
                  </Table.ColumnHeader>
                  <Table.ColumnHeader sortKey="deployment_count" sortable>
                    Deployments
                  </Table.ColumnHeader>
                  <Table.ColumnHeader sortKey="app_names" sortable>
                    Apper
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {deliveries.map((delivery) => (
                  <Table.Row key={delivery.id}>
                    <Table.DataCell>
                      {delivery.first_deployed_at
                        ? new Date(delivery.first_deployed_at).toLocaleDateString('nb-NO')
                        : '–'}
                    </Table.DataCell>
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
                        <AkselLink
                          as={Link}
                          to={`/team/${item.team_slug}/env/${item.environment_name}/app/${item.app_name}/deployments/${item.deployment_id}`}
                        >
                          {item.app_name}
                        </AkselLink>
                      </Table.DataCell>
                      <Table.DataCell>
                        <CommitLink
                          repository={{
                            githubOwner: item.detected_github_owner,
                            githubRepoName: item.detected_github_repo_name,
                          }}
                          sha={item.commit_sha}
                        />
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
        <AkselLink as={Link} to={adminUrl}>
          ← Tilbake til admin
        </AkselLink>
      </BodyShort>
    </VStack>
  )
}
