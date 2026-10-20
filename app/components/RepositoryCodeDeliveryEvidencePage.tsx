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
import {
  type ManualApprovalHistoryEntry,
  RepositoryManualApprovalHistory,
} from '~/components/RepositoryManualApprovalHistory'
import { UserName } from '~/components/UserName'
import type { RepositoryCodeDeliveryEvidence } from '~/db/repository-code-delivery-overview.server'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import type { RepositoryDeliveryApprovalAssessment } from '~/lib/repository-code-delivery/approval-assessment'
import { repositoryDeliveryRangeMatches } from '~/lib/repository-code-delivery/evidence'
import type { RepositoryDeliveryCommitAssessmentStatus } from '~/lib/repository-code-delivery/interval-assessment'
import { assessmentReasonLabel } from '~/lib/repository-code-delivery/interval-assessment-display'
import type { UserLookupMap } from '~/lib/user-display'

interface RepositoryCodeDeliveryEvidencePageProps {
  repository: { id: number; githubOwner: string; githubRepoName: string }
  delivery: RepositoryCodeDeliveryEvidence
  approvalAssessment: RepositoryDeliveryApprovalAssessment
  manualApprovalHistory: ManualApprovalHistoryEntry[]
  userMappings: UserLookupMap
  canApprove?: boolean
  canRevoke?: boolean
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

function assessmentStatusLabel(status: RepositoryDeliveryCommitAssessmentStatus): string {
  if (status === 'covered') return 'PR-review dekker'
  if (status === 'not_covered') return 'Ikke dekket'
  return 'Ukjent'
}

function approvalStatusLabel(status: RepositoryDeliveryApprovalAssessment['status']): string {
  if (status === 'approved') return 'Hele intervallet er dekket'
  if (status === 'not_approved') return 'Krever manuell godkjenning'
  if (status === 'no_changes') return 'Ingen commits i intervallet'
  return 'Kan ikke vurderes'
}

function approvalCommitReasonLabel(reason: RepositoryDeliveryApprovalAssessment['commits'][number]['reason']): string {
  const labels: Record<RepositoryDeliveryApprovalAssessment['commits'][number]['reason'], string> = {
    approved_pr: 'Dekket av PR etter NDA sine eksisterende regler',
    manual_approval: 'Dekket av manuell godkjenning',
    missing_approval: 'Ingen manuell godkjenning dekker denne commiten',
    unknown_pr_coverage: 'PR-kobling eller review-grunnlag er ukjent',
    unknown_commit_author: 'Commit author mangler verifisert GitHub-konto eller kobling til NAV-ident',
    unknown_approver_identity: 'Godkjenner kan ikke kobles sikkert til en NAV-ident',
    incomplete_commit_history: 'Commit-historikken er ufullstendig',
    invalid_interval: 'Commit-historikken samsvarer ikke med leveranseintervallet',
    duplicate_commit: 'Commit-historikken inneholder duplikate commits',
    approval_outside_interval: 'En godkjenning viser til en commit utenfor intervallet',
  }
  return labels[reason]
}

function RepositoryApprovalAssessment({
  repository,
  delivery,
  approvalAssessment,
  userMappings,
}: {
  repository: { githubOwner: string; githubRepoName: string }
  delivery: RepositoryCodeDeliveryEvidence
  approvalAssessment: RepositoryDeliveryApprovalAssessment
  userMappings: UserLookupMap
}) {
  const intervalCommitsBySha = new Map(
    delivery.interval_assessment.commits.map((commit) => [commit.sha.toLowerCase(), commit]),
  )
  const counts = {
    covered: approvalAssessment.commits.filter((commit) => commit.status === 'covered').length,
    notCovered: approvalAssessment.commits.filter((commit) => commit.status === 'not_covered').length,
    unknown: approvalAssessment.commits.filter((commit) => commit.status === 'unknown').length,
  }

  return (
    <div>
      <Heading level="2" size="small" spacing>
        Forhåndsvurdering av repositorygodkjenning
      </Heading>
      <VStack gap="space-16">
        <Alert variant="info" size="small">
          Skrivebeskyttet vurdering av lagrede GitHub-snapshots med NDA sine eksisterende PR-regler, inkludert implisitt
          godkjenning, kombinert med gyldige manuelle delgodkjenninger. Ukjent PR-grunnlag gir ikke manuell dekning.
          Vurderingen oppretter ingen beslutning og endrer ikke deploymentstatus.
        </Alert>
        <HStack gap="space-8" align="center" wrap>
          <Tag
            data-color={
              approvalAssessment.status === 'approved'
                ? 'success'
                : approvalAssessment.status === 'not_approved'
                  ? 'warning'
                  : 'neutral'
            }
            variant="outline"
            size="small"
          >
            {approvalStatusLabel(approvalAssessment.status)}
          </Tag>
          {approvalAssessment.status !== 'no_changes' && (
            <>
              <Tag data-color="success" variant="outline" size="small">
                Dekket: {counts.covered}
              </Tag>
              <Tag data-color="warning" variant="outline" size="small">
                Trenger godkjenning: {counts.notCovered}
              </Tag>
              <Tag data-color="neutral" variant="outline" size="small">
                Ukjent: {counts.unknown + approvalAssessment.omittedCommits}
              </Tag>
              <BodyShort size="small" textColor="subtle">
                {approvalAssessment.totalCommits === null
                  ? `${approvalAssessment.listedCommits} commits vist · totalt antall ukjent`
                  : `${approvalAssessment.listedCommits} av ${approvalAssessment.totalCommits} commits vurdert`}
              </BodyShort>
            </>
          )}
        </HStack>
        {approvalAssessment.status === 'no_changes' ? (
          <BodyShort>Dette er et anker uten kodeendringer, ikke en godkjenning.</BodyShort>
        ) : approvalAssessment.status === 'incomplete' ? (
          <Alert variant="warning" size="small">
            Grunnlaget er ufullstendig eller kan ikke knyttes sikkert til leveranseintervallet. Ukjent evidens gir ikke
            godkjenning.
          </Alert>
        ) : null}
        {approvalAssessment.commits.length > 0 && (
          <Table size="small">
            <caption className="aksel-sr-only">Forhåndsvurdering av repositorygodkjenning per commit</caption>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Commit</Table.HeaderCell>
                <Table.HeaderCell>GitHub commit author</Table.HeaderCell>
                <Table.HeaderCell>PR-grunnlag</Table.HeaderCell>
                <Table.HeaderCell>Vurdering</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {approvalAssessment.commits.map((commit) => {
                const intervalCommit = intervalCommitsBySha.get(commit.sha.toLowerCase())
                const authorLogin = intervalCommit?.authorLogin
                const authorMapping = authorLogin ? userMappings[authorLogin] : null

                return (
                  <Table.Row key={commit.sha}>
                    <Table.DataCell>
                      <VStack gap="space-4">
                        <CommitLink repository={repository} sha={commit.sha} />
                        {intervalCommit && <BodyShort size="small">{intervalCommit.message.split('\n')[0]}</BodyShort>}
                      </VStack>
                    </Table.DataCell>
                    <Table.DataCell>
                      {authorLogin ? (
                        <VStack gap="space-4">
                          <ExternalLink href={`https://github.com/${authorLogin}`}>
                            <UserName username={authorLogin} userMappings={userMappings} link={false} />
                          </ExternalLink>
                          <BodyShort size="small" textColor="subtle">
                            {authorMapping?.nav_ident
                              ? `Koblet til NAV-ident ${authorMapping.nav_ident}`
                              : 'Ikke koblet til NAV-ident'}
                          </BodyShort>
                        </VStack>
                      ) : (
                        'Ukjent'
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      {intervalCommit?.pullRequestNumber ? (
                        <VStack gap="space-4">
                          <ExternalLink
                            href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/pull/${intervalCommit.pullRequestNumber}`}
                          >
                            PR #{intervalCommit.pullRequestNumber}
                          </ExternalLink>
                          <BodyShort size="small">
                            {intervalCommit.status === 'covered'
                              ? 'Godkjent etter NDA-reglene'
                              : intervalCommit.status === 'not_covered'
                                ? assessmentReasonLabel(intervalCommit.reason)
                                : 'PR-grunnlaget er ukjent'}
                          </BodyShort>
                        </VStack>
                      ) : (
                        'Ingen dokumentert PR-dekning'
                      )}
                    </Table.DataCell>
                    <Table.DataCell>
                      <VStack gap="space-4">
                        <Tag
                          data-color={
                            commit.status === 'covered'
                              ? 'success'
                              : commit.status === 'not_covered'
                                ? 'warning'
                                : 'neutral'
                          }
                          variant="outline"
                          size="small"
                        >
                          {commit.status === 'covered'
                            ? 'Dekket'
                            : commit.status === 'not_covered'
                              ? 'Trenger manuell godkjenning'
                              : 'Ukjent'}
                        </Tag>
                        <BodyShort size="small">{approvalCommitReasonLabel(commit.reason)}</BodyShort>
                      </VStack>
                    </Table.DataCell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </VStack>
    </div>
  )
}

function IntervalAssessment({
  repository,
  delivery,
}: {
  repository: { githubOwner: string; githubRepoName: string }
  delivery: RepositoryCodeDeliveryEvidence
}) {
  const assessment = delivery.interval_assessment
  return (
    <div>
      <Heading level="2" size="small" spacing>
        Indikasjon på PR-review-dekning
      </Heading>
      <VStack gap="space-16">
        <Alert variant={assessment.state === 'complete' ? 'info' : 'warning'} size="small">
          Vurderingen bruker bare lagrede GitHub-snapshots og gjeldende PR-review-regler. Den vurderer ikke
          deployment-spesifikk base-merge-behandling, oppretter ingen repositorygodkjenning og endrer ikke
          deploymentstatus. «PR-review dekker» er derfor ikke en repositorygodkjenning.
        </Alert>
        <HStack gap="space-8" align="center" wrap>
          <Tag data-color="success" variant="outline" size="small">
            Dekket: {assessment.summary.covered}
          </Tag>
          <Tag data-color="warning" variant="outline" size="small">
            Ikke dekket: {assessment.summary.notCovered}
          </Tag>
          <Tag data-color="neutral" variant="outline" size="small">
            Ukjent: {assessment.summary.unknown}
          </Tag>
          {assessment.totalCommits !== null && (
            <BodyShort size="small" textColor="subtle">
              {assessment.listedCommits} av {assessment.totalCommits} commits vist
              {assessment.defaultBranch ? ` · branch ${assessment.defaultBranch}` : ''}
            </BodyShort>
          )}
        </HStack>
        {assessment.state === 'unavailable' ? (
          <BodyShort textColor="subtle">
            Et lagret GitHub-sammenligningssnapshot for dette intervallet er ikke tilgjengelig.
          </BodyShort>
        ) : assessment.omittedCommits > 0 ? (
          <Alert variant="warning" size="small">
            Sammenligningssnapshotten mangler {assessment.omittedCommits} commit(er). De er regnet som ukjent
            dokumentasjon.
          </Alert>
        ) : null}
        {assessment.commits.length > 0 && (
          <Table size="small">
            <caption className="aksel-sr-only">PR-review-vurdering per commit i leveranseintervallet</caption>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Commit</Table.HeaderCell>
                <Table.HeaderCell>PR</Table.HeaderCell>
                <Table.HeaderCell>Lagret evidens</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {assessment.commits.map((commit) => (
                <Table.Row key={commit.sha}>
                  <Table.DataCell>
                    <VStack gap="space-4">
                      <CommitLink repository={repository} sha={commit.sha} />
                      <BodyShort size="small">{commit.message.split('\n')[0]}</BodyShort>
                    </VStack>
                  </Table.DataCell>
                  <Table.DataCell>
                    {commit.pullRequestNumber ? (
                      <ExternalLink
                        href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/pull/${commit.pullRequestNumber}`}
                      >
                        PR #{commit.pullRequestNumber}
                      </ExternalLink>
                    ) : (
                      '—'
                    )}
                  </Table.DataCell>
                  <Table.DataCell>
                    <VStack gap="space-4">
                      <Tag
                        data-color={
                          commit.status === 'covered'
                            ? 'success'
                            : commit.status === 'not_covered'
                              ? 'warning'
                              : 'neutral'
                        }
                        variant="outline"
                        size="small"
                      >
                        {assessmentStatusLabel(commit.status)}
                      </Tag>
                      <BodyShort size="small">{assessmentReasonLabel(commit.reason)}</BodyShort>
                    </VStack>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </VStack>
    </div>
  )
}

export function RepositoryCodeDeliveryEvidencePage({
  repository,
  delivery,
  approvalAssessment,
  manualApprovalHistory,
  userMappings,
  canApprove = false,
  canRevoke = false,
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
        leveransen, med forhåndsvurdering av repositorygodkjenning og manuell historikk. Den oppretter ingen
        repositorygodkjenning og endrer ikke deploymentstatus. Manglende snapshot betyr ukjent grunnlag, ikke at reviews
        mangler.
      </Alert>

      {canApprove && (
        <AkselLink
          as={Link}
          to={`/repository/${repository.githubOwner}/${repository.githubRepoName}/approvals/${delivery.id}?repositoryId=${repository.id}`}
        >
          Start manuell repositorygodkjenning
        </AkselLink>
      )}

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

      <IntervalAssessment repository={repository} delivery={delivery} />
      <RepositoryApprovalAssessment
        repository={repository}
        delivery={delivery}
        approvalAssessment={approvalAssessment}
        userMappings={userMappings}
      />
      <RepositoryManualApprovalHistory
        repository={repository}
        entries={manualApprovalHistory}
        canRevoke={canRevoke}
        firstDeployedAt={delivery.first_deployed_at ?? null}
      />

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
