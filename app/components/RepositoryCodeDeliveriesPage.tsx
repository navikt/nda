import {
  Accordion,
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Heading,
  HStack,
  Select,
  type SortState,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import type { UnresolvedReason } from '~/db/repository-code-delivery-establishment.server'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import type { RepositoryDeliveryApprovalAssessment } from '~/lib/repository-code-delivery/approval-assessment'
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
  status: RepositoryDeliveryApprovalAssessment['status'] | 'all'
  followUpCounts: Record<RepositoryDeliveryApprovalAssessment['status'], number>
  filteredTotal: number
  canApprove: boolean
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
    assessment: {
      state: 'complete' | 'incomplete' | 'unavailable'
      totalCommits: number | null
      listedCommits: number
      summary: { covered: number; notCovered: number; unknown: number }
    }
    pullRequestNumbers: number[]
    followUp: {
      status: RepositoryDeliveryApprovalAssessment['status']
      covered: number
      needsApproval: number
      unknown: number
    }
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
  status,
  followUpCounts,
  filteredTotal,
  canApprove,
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
  const followUpLabels = {
    approved: { label: 'Alle commits dekket', color: 'success' },
    not_approved: { label: 'Trenger manuell godkjenning', color: 'warning' },
    incomplete: { label: 'Ufullstendig grunnlag', color: 'neutral' },
    no_changes: { label: 'Anker – ingen kodeendringer', color: 'neutral' },
  } as const

  const deliveryList = (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Leveranser
        </Heading>
        <BodyShort size="small" textColor="subtle">
          Oppfølging kombinerer PR-review med gyldige manuelle godkjenninger. Dette er en forhåndsvurdering, ikke en
          lagret repositorybeslutning.
        </BodyShort>
        <Form method="get">
          <HStack gap="space-12" align="end" wrap>
            <input type="hidden" name="repositoryId" value={repository.id} />
            {sort && (
              <>
                <input type="hidden" name="sort" value={sort.orderBy} />
                <input type="hidden" name="direction" value={sort.direction} />
              </>
            )}
            <Select key={status} label="Oppfølging" name="status" defaultValue={status} size="small">
              <option value="all">Alle</option>
              {Object.entries(followUpLabels).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Button type="submit" size="small" variant="secondary">
              Filtrer
            </Button>
          </HStack>
        </Form>
        <BodyShort size="small">{filteredTotal} leveranser funnet</BodyShort>
        {deliveries.length === 0 ? (
          <BodyShort textColor="subtle">
            {overview.deliveryCount === 0
              ? 'Ingen leveranser er registrert ennå.'
              : 'Ingen leveranser passer til filteret.'}
          </BodyShort>
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
                <Table.HeaderCell>Oppfølging</Table.HeaderCell>
                <Table.HeaderCell>PR</Table.HeaderCell>
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
                  <Table.DataCell>
                    <VStack gap="space-8">
                      <Tag data-color={followUpLabels[delivery.followUp.status].color} variant="outline" size="small">
                        {followUpLabels[delivery.followUp.status].label}
                      </Tag>
                      {delivery.followUp.status !== 'no_changes' && (
                        <BodyShort size="small">
                          Dekket {delivery.followUp.covered} · Trenger godkjenning {delivery.followUp.needsApproval} ·
                          Ukjent {delivery.followUp.unknown}
                        </BodyShort>
                      )}
                      {delivery.followUp.status === 'incomplete' && (
                        <BodyShort size="small" textColor="subtle">
                          {delivery.assessment.state === 'unavailable'
                            ? 'Sammenligningsgrunnlag mangler'
                            : 'Evidens eller identitetskobling må avklares'}
                        </BodyShort>
                      )}
                      {delivery.followUp.status === 'not_approved' && canApprove && (
                        <AkselLink
                          as={Link}
                          to={`/repository/${repository.githubOwner}/${repository.githubRepoName}/approvals/${delivery.id}?repositoryId=${repository.id}`}
                        >
                          Godkjenn {delivery.followUp.needsApproval}{' '}
                          {delivery.followUp.needsApproval === 1 ? 'commit' : 'commits'}
                        </AkselLink>
                      )}
                      <AkselLink
                        as={Link}
                        to={`/repository/${repository.githubOwner}/${repository.githubRepoName}/admin/code-deliveries/${delivery.id}?repositoryId=${repository.id}`}
                      >
                        {delivery.followUp.status === 'incomplete' ? 'Undersøk grunnlaget' : 'Vis detaljer'}
                      </AkselLink>
                      <AkselLink
                        as="a"
                        href={`/repository/${repository.githubOwner}/${repository.githubRepoName}/admin/code-deliveries/export?repositoryId=${repository.id}&deliveryId=${delivery.id}`}
                      >
                        Last ned analysegrunnlag
                      </AkselLink>
                    </VStack>
                  </Table.DataCell>
                  <Table.DataCell>
                    {delivery.pullRequestNumbers.length > 0 ? (
                      <HStack gap="space-8" wrap>
                        {delivery.pullRequestNumbers.map((number) => (
                          <ExternalLink
                            key={number}
                            href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/pull/${number}`}
                          >
                            PR #{number}
                          </ExternalLink>
                        ))}
                      </HStack>
                    ) : (
                      '–'
                    )}
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
        <PaginationControls page={page} totalPages={totalPages} onPageChange={onPageChange} />
      </VStack>
    </Box>
  )

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
            {[
              ['Leveranser', overview.deliveryCount],
              ['Trenger manuell godkjenning', followUpCounts.not_approved],
              ['Ufullstendig grunnlag', followUpCounts.incomplete],
              ['Alle commits dekket', followUpCounts.approved],
              ['Koblede deployments', overview.linkedDeploymentCount],
              ['Deployments som venter på leveranse', overview.awaitingDeploymentCount],
              ['Uavklarte deployments', unresolvedTotal],
            ].map(([label, count]) => (
              <div key={label}>
                <BodyShort size="small" textColor="subtle">
                  {label}
                </BodyShort>
                <BodyShort weight="semibold" size="large">
                  {count}
                </BodyShort>
              </div>
            ))}
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
      {deliveryList}
      <Accordion headingSize="small">
        <Accordion.Item>
          <Accordion.Header>Grunnlag for historisk innlesing</Accordion.Header>
          <Accordion.Content>
            <VStack gap="space-16">
              <BodyShort size="small" textColor="subtle">
                Viser apper med aktiv eller historisk kobling via stabil GitHub repository-ID. Manglende repository-ID
                på en app-deployment betyr ikke i seg selv at den tilhører dette repositoryet. Navnebaserte historiske
                koblinger uten stabil ID vises ikke og må avklares separat.
              </BodyShort>
              <BodyShort size="small">
                {historyReadiness.applications.filter((app) => app.initial_nais_history_synced_at !== null).length} av{' '}
                {historyReadiness.applications.length} kjente apper har markert fullført initial Nais-historikksynk.
                Dette bekrefter ikke alene at repositorykoblinger og Git-ancestry er komplette eller entydige.
              </BodyShort>
              <BodyShort size="small" textColor="subtle">
                Hent analysegrunnlag per uavklart deployment fra listen under. Eksporten inkluderer to registrerte
                kodeleveranser på hver side når de finnes, tilknyttede deployments og deres lagrede GitHub-bevis. Ved
                nedlasting hentes også PR-reviewer og Actions-jobber fra GitHub; status i JSON viser hvis data ikke
                kunne hentes.
              </BodyShort>
              <Button
                as="a"
                href={`/repository/${repository.githubOwner}/${repository.githubRepoName}/admin/code-deliveries/export?repositoryId=${repository.id}`}
                size="small"
                variant="secondary"
              >
                Last ned analysegrunnlag for alle uavklarte
              </Button>
              <BodyShort size="small">
                {historyReadiness.repositoryDeploymentCount} deployments har stabil repository-ID;{' '}
                {historyReadiness.repositoryDeploymentsMissingShaCount} av disse mangler full commit-SHA, og{' '}
                {historyReadiness.repositoryDeploymentsWithoutKnownAppLinkCount} kommer fra apper uten en kjent aktiv
                eller historisk kobling med denne repository-ID-en.
              </BodyShort>
              {historyReadiness.applications.length === 0 ? (
                <BodyShort textColor="subtle">Ingen apper med stabil repository-ID-kobling er funnet.</BodyShort>
              ) : (
                <Table size="small">
                  <caption className="aksel-sr-only">
                    Historikksynk og deploymentdekning per repositorykoblet app
                  </caption>
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
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>

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
                    <Table.HeaderCell>Analysegrunnlag</Table.HeaderCell>
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
                      <Table.DataCell>
                        <AkselLink
                          as="a"
                          href={`/repository/${repository.githubOwner}/${repository.githubRepoName}/admin/code-deliveries/export?repositoryId=${repository.id}&deploymentId=${item.deployment_id}`}
                        >
                          Last ned JSON
                        </AkselLink>
                      </Table.DataCell>
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
