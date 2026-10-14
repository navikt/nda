import {
  Accordion,
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Heading,
  HStack,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import { PaginationControls } from '~/components/deployments/PaginationControls'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import type { RepositoryCodeDeliveryEvidence } from '~/db/repository-code-delivery-overview.server'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import { repositoryDeliveryRangeMatches } from '~/lib/repository-code-delivery/evidence'
import type { UserLookupMap } from '~/lib/user-display'

interface RepositoryCodeDeliveryEvidencePageProps {
  repository: { id: number; githubOwner: string; githubRepoName: string }
  delivery: RepositoryCodeDeliveryEvidence
  userMappings: UserLookupMap
}

function CommitLink({ repository, sha }: { repository: { githubOwner: string; githubRepoName: string }; sha: string }) {
  return (
    <ExternalLink href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/commit/${sha}`}>
      <code>{sha}</code>
    </ExternalLink>
  )
}

function ReviewSnapshot({
  repository,
  snapshot,
  userMappings,
}: {
  repository: { githubOwner: string; githubRepoName: string }
  snapshot: RepositoryCodeDeliveryEvidence['deployments'][number]['verification_runs'][number]['review_snapshots'][number]
  userMappings: UserLookupMap
}) {
  return (
    <Box padding="space-16" borderRadius="8" background="sunken" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-12">
        <Heading level="4" size="xsmall">
          <ExternalLink
            href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/pull/${snapshot.pr_number}`}
          >
            PR #{snapshot.pr_number}
          </ExternalLink>
        </Heading>
        <BodyShort size="small" textColor="subtle">
          Snapshot hentet {formatAuditLogTimestamp(snapshot.fetched_at)} · {snapshot.source}
        </BodyShort>
        {!snapshot.github_available ? (
          <Alert variant="warning" size="small">
            GitHub-data var ikke tilgjengelig da snapshotten ble lagret. Dette sier ikke om PR-en hadde reviews.
          </Alert>
        ) : snapshot.reviews === null ? (
          <Alert variant="warning" size="small">
            Review-data i snapshotten kunne ikke leses. Innholdet kan ikke brukes som bevis.
          </Alert>
        ) : snapshot.reviews.length === 0 ? (
          <BodyShort size="small">Snapshotten inneholder ingen review-rader.</BodyShort>
        ) : (
          <Table size="small">
            <caption className="aksel-sr-only">Lagrede reviews for PR #{snapshot.pr_number}</caption>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Reviewer</Table.HeaderCell>
                <Table.HeaderCell>Tilstand</Table.HeaderCell>
                <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
                <Table.HeaderCell>Commit</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {snapshot.reviews.map((review) => (
                <Table.Row
                  key={
                    review.id ??
                    `${review.username}-${review.state}-${review.submittedAt ?? 'unknown'}-${review.commitSha ?? 'unknown'}`
                  }
                >
                  <Table.DataCell>
                    <ExternalLink href={`https://github.com/${review.username}`}>
                      <UserName username={review.username} userMappings={userMappings} link={false} />
                    </ExternalLink>
                  </Table.DataCell>
                  <Table.DataCell>{review.state}</Table.DataCell>
                  <Table.DataCell>
                    {review.submittedAt ? formatAuditLogTimestamp(review.submittedAt) : 'Ukjent'}
                  </Table.DataCell>
                  <Table.DataCell>
                    {review.commitSha ? <CommitLink repository={repository} sha={review.commitSha} /> : 'Ikke oppgitt'}
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </VStack>
    </Box>
  )
}

export function RepositoryCodeDeliveryEvidencePage({
  repository,
  delivery,
  userMappings,
}: RepositoryCodeDeliveryEvidencePageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const deliveriesUrl = `/repository/${repository.githubOwner}/${repository.githubRepoName}/admin/code-deliveries?repositoryId=${repository.id}`
  const anchor = delivery.base_sha.toLowerCase() === delivery.head_sha.toLowerCase()
  const goToPage = (page: number) => {
    const updatedSearchParams = new URLSearchParams(searchParams)
    updatedSearchParams.set('page', String(page))
    setSearchParams(updatedSearchParams)
  }

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="medium" spacing>
          Lagret review-grunnlag
        </Heading>
        <BodyShort textColor="subtle">
          {repository.githubOwner}/{repository.githubRepoName}
        </BodyShort>
      </div>

      <Alert variant="info" size="small">
        Dette er en skrivebeskyttet visning av snapshots knyttet til verifiseringskjøringer for deployments av denne
        leveransen. Den vurderer ikke om hele intervallet er dekket, oppretter ingen repositorygodkjenning og endrer
        ikke deploymentstatus. Manglende snapshot betyr ukjent grunnlag, ikke at reviews mangler.
      </Alert>

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading level="2" size="small">
            Låst leveranseintervall
          </Heading>
          {anchor ? (
            <BodyShort>
              Anker <CommitLink repository={repository} sha={delivery.head_sha} />. Dette markerer historikkens
              startpunkt, ikke en kodegodkjenning.
            </BodyShort>
          ) : (
            <HStack gap="space-8" align="center" wrap>
              <CommitLink repository={repository} sha={delivery.base_sha} />
              <BodyShort aria-hidden>→</BodyShort>
              <CommitLink repository={repository} sha={delivery.head_sha} />
            </HStack>
          )}
          <BodyShort size="small" textColor="subtle">
            Registrert {formatAuditLogTimestamp(delivery.created_at)}
          </BodyShort>
        </VStack>
      </Box>

      <div>
        <Heading level="2" size="small" spacing>
          Knyttede deployments og lagrede verifiseringer
        </Heading>
        {delivery.deployments.length === 0 ? (
          <BodyShort textColor="subtle">Ingen deployments er knyttet til leveransen.</BodyShort>
        ) : (
          <VStack gap="space-16">
            {delivery.deployments.map((deployment) => (
              <Box
                key={deployment.id}
                padding="space-20"
                borderRadius="8"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
              >
                <VStack gap="space-16">
                  <div>
                    <Heading level="3" size="small" spacing>
                      <AkselLink
                        as={Link}
                        to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}`}
                      >
                        {deployment.app_name}
                      </AkselLink>
                    </Heading>
                    <BodyShort size="small" textColor="subtle">
                      {deployment.team_slug} · {deployment.environment_name} ·{' '}
                      {formatAuditLogTimestamp(deployment.deployed_at)}
                    </BodyShort>
                  </div>
                  {deployment.verification_runs.length === 0 ? (
                    <BodyShort textColor="subtle">Ingen lagret verifiseringskjøring for deploymentet.</BodyShort>
                  ) : (
                    <Accordion>
                      {deployment.verification_runs.map((run) => {
                        const rangeMatch = repositoryDeliveryRangeMatches(run.comparison_range, {
                          baseSha: delivery.base_sha,
                          headSha: delivery.head_sha,
                        })
                        return (
                          <Accordion.Item key={run.id}>
                            <Accordion.Header>
                              Verifisering {formatAuditLogTimestamp(run.run_at)} · {run.status}
                            </Accordion.Header>
                            <Accordion.Content>
                              <VStack gap="space-16">
                                <HStack gap="space-8" align="center" wrap>
                                  <BodyShort size="small">
                                    Lagret intervall:{' '}
                                    {run.comparison_range ? (
                                      <>
                                        <CommitLink repository={repository} sha={run.comparison_range.baseSha} /> →{' '}
                                        <CommitLink repository={repository} sha={run.comparison_range.headSha} />
                                      </>
                                    ) : run.comparison_range_invalid ? (
                                      'lagret, men har ugyldig format'
                                    ) : (
                                      'ikke lagret'
                                    )}
                                  </BodyShort>
                                  {rangeMatch !== null && (
                                    <Tag data-color={rangeMatch ? 'success' : 'warning'} variant="outline" size="small">
                                      {rangeMatch ? 'Samme SHA-intervall' : 'Annet SHA-intervall'}
                                    </Tag>
                                  )}
                                </HStack>
                                {run.review_snapshots.length === 0 ? (
                                  <BodyShort size="small">
                                    Ingen review-snapshot er tilgjengelig for denne verifiseringskjøringen. Det betyr
                                    ikke at PR-en manglet reviews.
                                  </BodyShort>
                                ) : (
                                  <VStack gap="space-12">
                                    {run.review_snapshots.map((snapshot) => (
                                      <ReviewSnapshot
                                        key={snapshot.id}
                                        repository={repository}
                                        snapshot={snapshot}
                                        userMappings={userMappings}
                                      />
                                    ))}
                                  </VStack>
                                )}
                                <BodyShort size="small" textColor="subtle">
                                  Verifiseringsstatusen gjelder deploymentet på tidspunktet for kjøringen; den er ikke
                                  en repositorybeslutning.
                                </BodyShort>
                              </VStack>
                            </Accordion.Content>
                          </Accordion.Item>
                        )
                      })}
                    </Accordion>
                  )}
                </VStack>
              </Box>
            ))}
            <PaginationControls page={delivery.page} totalPages={delivery.totalPages} onPageChange={goToPage} />
          </VStack>
        )}
      </div>

      <BodyShort size="small">
        <AkselLink as={Link} to={deliveriesUrl}>
          ← Tilbake til kodeleveranser
        </AkselLink>
      </BodyShort>
    </VStack>
  )
}
