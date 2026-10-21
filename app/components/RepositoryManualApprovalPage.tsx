import {
  Accordion,
  Link as AkselLink,
  Alert,
  BodyShort,
  Button,
  Heading,
  Table,
  Textarea,
  VStack,
} from '@navikt/ds-react'
import { Link, useFetcher } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { ExternalLink } from '~/components/ExternalLink'
import {
  type ManualApprovalHistoryEntry,
  RepositoryManualApprovalHistory,
} from '~/components/RepositoryManualApprovalHistory'
import { UserName } from '~/components/UserName'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import { assessmentReasonLabel } from '~/lib/repository-code-delivery/interval-assessment-display'
import type { RepositoryApprovalPreview } from '~/lib/repository-manual-approval'

type ApprovalActionData = {
  error?: string
  success?: string
  registered?: boolean
}

export function RepositoryApprovalSnapshot({
  repository,
  review,
}: {
  repository: { githubOwner: string; githubRepoName: string }
  review: RepositoryApprovalPreview
}) {
  const commitUrl = (sha: string) =>
    `https://github.com/${repository.githubOwner}/${repository.githubRepoName}/commit/${sha}`
  return (
    <section aria-labelledby="frozen-review-heading">
      <VStack gap="space-16">
        <Heading id="frozen-review-heading" size="medium" level="2">
          Vurderingsgrunnlag
        </Heading>
        <BodyShort>
          Intervall: <code>{review.baseSha}</code> → <code>{review.headSha}</code>
        </BodyShort>
        <ExternalLink
          href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/compare/${review.baseSha}...${review.headSha}`}
        >
          Åpne kodeendringene på GitHub
        </ExternalLink>
        <Alert variant="info">
          Grunnlaget er en forhåndsvisning. Det kontrolleres på nytt når du godkjenner. Godkjenningen registreres bare
          for commits som mangler kjent PR-dekning og som du kan godkjenne.
        </Alert>
        <BodyShort>
          Default-branch: {review.defaultBranch ?? 'Ukjent'} · Regel for implisitt PR-godkjenning:{' '}
          {review.implicitApprovalMode}
        </BodyShort>
        <Table size="small">
          <caption>Commits og PR-dekning</caption>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Commit og forfatter</Table.HeaderCell>
              <Table.HeaderCell>Git-tider</Table.HeaderCell>
              <Table.HeaderCell>PR-dekning og godkjenning</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {review.commits.map((commit) => (
              <Table.Row key={commit.sha}>
                <Table.DataCell>
                  <ExternalLink href={commitUrl(commit.sha)}>
                    <code>{commit.sha}</code>
                  </ExternalLink>
                  <BodyShort>{commit.message}</BodyShort>
                  <BodyShort size="small">
                    {commit.authorLogin ? (
                      <UserName username={commit.authorLogin} userMappings={{}} link={false} />
                    ) : (
                      'Ukjent forfatter'
                    )}
                    {' · '}
                    {commit.authorNavIdent ?? 'Ukjent NAV-ident'}
                  </BodyShort>
                </Table.DataCell>
                <Table.DataCell>
                  <BodyShort size="small">Author: {commit.authorDate || 'Mangler'}</BodyShort>
                  <BodyShort size="small">Committer: {commit.committerDate || 'Mangler'}</BodyShort>
                </Table.DataCell>
                <Table.DataCell>
                  <BodyShort>
                    {commit.prStatus === 'covered'
                      ? 'Dekket av PR – kan ikke godkjennes manuelt'
                      : commit.prStatus === 'not_covered'
                        ? 'Ikke dekket av PR'
                        : 'Ukjent PR-grunnlag'}
                  </BodyShort>
                  {commit.prStatus === 'not_covered' && (
                    <BodyShort size="small">{commit.unavailableReason ?? 'Kan godkjennes manuelt'}</BodyShort>
                  )}
                  <BodyShort size="small">Grunn: {assessmentReasonLabel(commit.prReason)}</BodyShort>
                  {commit.pullRequestNumber && <BodyShort size="small">PR #{commit.pullRequestNumber}</BodyShort>}
                  <BodyShort size="small">
                    {commit.associations?.complete
                      ? 'Komplett lagret PR-kobling'
                      : 'PR-koblingen mangler eller er ufullstendig'}
                    {commit.associations?.pullRequests.map((pr) => ` · #${pr.number} mot ${pr.baseBranch}`).join('')}
                  </BodyShort>
                  {commit.unavailableReason && <BodyShort size="small">{commit.unavailableReason}</BodyShort>}
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {review.pullRequests.length > 0 && (
          <Accordion>
            {review.pullRequests.map((pr) => (
              <Accordion.Item key={pr.number}>
                <Accordion.Header>Lagret PR #{pr.number}</Accordion.Header>
                <Accordion.Content>
                  <VStack gap="space-8">
                    <BodyShort>
                      Branch: {pr.baseBranch ?? 'Ukjent'} · Head: <code>{pr.headSha ?? 'Ukjent'}</code>
                    </BodyShort>
                    <BodyShort>
                      PR-forfatter:{' '}
                      {pr.authorLogin ? (
                        <UserName username={pr.authorLogin} userMappings={{}} link={false} />
                      ) : (
                        'Ukjent'
                      )}
                      {' · '}Merget av:{' '}
                      {pr.mergedByLogin ? (
                        <UserName username={pr.mergedByLogin} userMappings={{}} link={false} />
                      ) : (
                        'Ukjent'
                      )}
                      {' · '}Merge-commit: <code>{pr.mergeCommitSha ?? 'Ukjent'}</code>
                      {' · '}Antall commits: {pr.commitCount ?? 'Ukjent'}
                    </BodyShort>
                    <BodyShort size="small">
                      PR-tidene nedenfor er evaluatorens grunnlag etter eksisterende PR-regler. Bare
                      leveransecommittenes lagrede committer-tid ovenfor brukes som nedre grense for manuell reviewtid.
                    </BodyShort>
                    {pr.commits.map((commit) => (
                      <BodyShort key={commit.sha} size="small">
                        <code>{commit.sha}</code>
                        {' · '}
                        {commit.authorLogin ? (
                          <UserName username={commit.authorLogin} userMappings={{}} link={false} />
                        ) : (
                          'Ukjent forfatter'
                        )}
                        {' · '}Author: {commit.authorDate || 'Mangler'}
                        {' · '}Committer: {commit.committerDate || 'Mangler'}
                      </BodyShort>
                    ))}
                    {pr.reviews.length === 0 && <BodyShort>Ingen lagrede reviews.</BodyShort>}
                    {pr.reviews.map((entry) => (
                      <BodyShort
                        key={`${entry.username}-${entry.state}-${entry.submittedAt}-${entry.commitSha}`}
                        size="small"
                      >
                        <UserName username={entry.username} userMappings={{}} link={false} /> · {entry.state} ·{' '}
                        {entry.submittedAt}
                        {' · '}
                        <code>{entry.commitSha ?? 'Ukjent commit'}</code>
                      </BodyShort>
                    ))}
                  </VStack>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </VStack>
    </section>
  )
}

export function RepositoryApprovalConfirmation({ review }: { review: RepositoryApprovalPreview }) {
  const fetcher = useFetcher<ApprovalActionData>()
  const approvableCommits = review.commits.filter(
    (commit) => commit.prStatus === 'not_covered' && !commit.unavailableReason,
  )
  return (
    <VStack gap="space-16">
      <ActionAlert data={fetcher.data} />
      {!fetcher.data?.registered && approvableCommits.length > 0 && (
        <fetcher.Form method="post">
          <VStack gap="space-16">
            <input type="hidden" name="intent" value="approve-repository" />
            <input type="hidden" name="previewToken" value={review.previewToken} />
            <Textarea label="Kommentar (valgfritt)" name="note" />
            <Button type="submit" loading={fetcher.state !== 'idle'}>
              Godkjenn manuelt
            </Button>
          </VStack>
        </fetcher.Form>
      )}
      {!fetcher.data?.registered && approvableCommits.length === 0 && (
        <Alert variant="info">
          Ingen commits mangler kjent PR-dekning som du kan godkjenne manuelt. Ukjent PR-grunnlag kan ikke godkjennes.
        </Alert>
      )}
    </VStack>
  )
}

export interface RepositoryManualApprovalPageProps {
  repository: { id: number; githubOwner: string; githubRepoName: string }
  delivery: { id: number; base_sha: string; head_sha: string; first_deployed_at: Date | string | null }
  review: RepositoryApprovalPreview | null
  manualApprovalHistory: ManualApprovalHistoryEntry[]
}

export function RepositoryManualApprovalPage({
  repository,
  delivery,
  review,
  manualApprovalHistory,
}: RepositoryManualApprovalPageProps) {
  const fetcher = useFetcher<ApprovalActionData>()
  return (
    <VStack gap="space-24">
      <Heading size="large" level="1">
        Manuell repositorygodkjenning · {repository.githubOwner}/{repository.githubRepoName}
      </Heading>
      <AkselLink
        as={Link}
        to={`/repository/${repository.githubOwner}/${repository.githubRepoName}/approvals?repositoryId=${repository.id}`}
      >
        Til leveransene
      </AkselLink>
      <BodyShort>
        Leveranse {delivery.id}: <code>{delivery.base_sha}</code> → <code>{delivery.head_sha}</code>
      </BodyShort>
      <Alert variant="info">
        Bare commits uten kjent PR-dekning kan godkjennes manuelt. Godkjenningen endrer ikke deploymentstatus eller
        PR-regler. Review etter deployment registreres som etterfølgende godkjenning, ikke som godkjent ved deploy.
      </Alert>
      {delivery.first_deployed_at && (
        <BodyShort>Første tilknyttede deployment: {formatAuditLogTimestamp(delivery.first_deployed_at)}</BodyShort>
      )}
      {delivery.base_sha.toLowerCase() === delivery.head_sha.toLowerCase() ? (
        <Alert variant="info">
          Dette er startpunktet for repositoryhistorikken. Leveransen har ikke et endringsintervall som kan godkjennes
          manuelt.
        </Alert>
      ) : null}
      <ActionAlert data={fetcher.data} />
      {review && (
        <>
          <RepositoryApprovalSnapshot repository={repository} review={review} />
          <RepositoryApprovalConfirmation review={review} />
        </>
      )}
      {!review && delivery.base_sha.toLowerCase() !== delivery.head_sha.toLowerCase() && (
        <Alert variant="warning">
          Vurderingsgrunnlaget er ufullstendig. Godkjenning er ikke tilgjengelig, men tidligere godkjenninger vises
          nedenfor.
        </Alert>
      )}
      <RepositoryManualApprovalHistory
        repository={repository}
        entries={manualApprovalHistory}
        firstDeployedAt={delivery.first_deployed_at}
      />
    </VStack>
  )
}
