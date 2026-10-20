import {
  Accordion,
  Link as AkselLink,
  Alert,
  BodyShort,
  Button,
  Checkbox,
  CheckboxGroup,
  Heading,
  Table,
  Textarea,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
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
import type { RepositoryApprovalReview } from '~/lib/repository-manual-approval'

type ApprovalActionData = {
  error?: string
  success?: string
  review?: RepositoryApprovalReview
  registered?: boolean
  stale?: boolean
}

export function RepositoryApprovalSnapshot({
  repository,
  review,
}: {
  repository: { githubOwner: string; githubRepoName: string }
  review: RepositoryApprovalReview
}) {
  const commitUrl = (sha: string) =>
    `https://github.com/${repository.githubOwner}/${repository.githubRepoName}/commit/${sha}`
  return (
    <section aria-labelledby="frozen-review-heading">
      <VStack gap="space-16">
        <Heading id="frozen-review-heading" size="medium" level="2">
          Fryst vurderingsgrunnlag
        </Heading>
        <BodyShort>
          Lagret {formatAuditLogTimestamp(review.createdAt)} · Gjennomgås av {review.reviewer}
        </BodyShort>
        <BodyShort>
          Intervall: <code>{review.baseSha}</code> → <code>{review.headSha}</code>
        </BodyShort>
        <ExternalLink
          href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/compare/${review.baseSha}...${review.headSha}`}
        >
          Åpne kodeendringene på GitHub
        </ExternalLink>
        <Alert variant="info">
          Grunnlaget nedenfor er lagret og erstattes ikke automatisk. GitHub-lenker viser dagens innhold, ikke
          nødvendigvis det lagrede grunnlaget. Endret evidens eller identitet avvises ved lagring.
        </Alert>
        <BodyShort>
          Default-branch: {review.defaultBranch ?? 'Ukjent'} · Regel for implisitt PR-godkjenning:{' '}
          {review.implicitApprovalMode}
        </BodyShort>
        <Alert variant="warning">
          Lagret committer-tid brukes som nedre grense for reviewtid. Git-metadata er ikke sikkert tidsbevis. Manglende
          eller ugyldig committer-tid gir ingen godkjenning, og erstattes ikke med author-tid, deploymenttid eller
          registreringstid.
        </Alert>
        <Table size="small">
          <caption>Lagrede commits og PR-grunnlag</caption>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Commit og forfatter</Table.HeaderCell>
              <Table.HeaderCell>Lagrede Git-tider</Table.HeaderCell>
              <Table.HeaderCell>PR-grunnlag</Table.HeaderCell>
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
                      ? 'Dekket av PR'
                      : commit.prStatus === 'not_covered'
                        ? 'Ikke dekket av PR'
                        : 'Ukjent PR-grunnlag'}
                  </BodyShort>
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

export function RepositoryApprovalConfirmation({ review }: { review: RepositoryApprovalReview }) {
  const fetcher = useFetcher<ApprovalActionData>()
  const [selected, setSelected] = useState<string[]>([])
  const [reviewedAt, setReviewedAt] = useState('')
  const selectedTimes = review.commits
    .filter((commit) => selected.includes(commit.sha))
    .map((commit) => commit.committerDate)
  const latestSelected =
    selectedTimes.length > 0
      ? selectedTimes.reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest))
      : null
  return (
    <VStack gap="space-16">
      <ActionAlert data={fetcher.data} />
      {!fetcher.data?.registered && !fetcher.data?.stale && (
        <fetcher.Form method="post">
          <VStack gap="space-16">
            <input type="hidden" name="intent" value="register-approval" />
            <input type="hidden" name="snapshotId" value={review.snapshotId} />
            <Heading level="2" size="medium">
              Bekreft gjennomgangen
            </Heading>
            <CheckboxGroup legend="Velg committene du faktisk har gjennomgått" value={selected} onChange={setSelected}>
              {review.commits
                .filter((commit) => !commit.unavailableReason)
                .map((commit) => (
                  <Checkbox key={commit.sha} name="commitShas" value={commit.sha}>
                    <code>{commit.sha}</code> · {commit.message.split('\n')[0]}
                  </Checkbox>
                ))}
            </CheckboxGroup>
            {review.commits.every((commit) => commit.unavailableReason) && (
              <Alert variant="warning">Ingen commits kan velges i dette grunnlaget.</Alert>
            )}
            {latestSelected && (
              <BodyShort>
                Gjennomgangen kan ikke være før {latestSelected}, den nyeste valgte committens lagrede committer-tid.
              </BodyShort>
            )}
            <Textarea
              label="Hva har du gjennomgått?"
              description="Beskriv hva du kontrollerte i de valgte committene. Ikke oppgi personopplysninger eller hemmeligheter."
              name="reviewDocumentation"
              aria-required
            />
            <TextField label="Lenke til ytterligere dokumentasjon (valgfritt)" name="documentationUrl" type="url" />
            <TextField
              label="Faktisk tidspunkt for gjennomgangen"
              description="Oppgi dato og klokkeslett med tidssone, for eksempel 2026-10-19T11:30:00+02:00. Tidspunktet kan ikke være i fremtiden."
              name="reviewedAt"
              value={reviewedAt}
              onChange={(event) => setReviewedAt(event.target.value)}
              aria-required
            />
            <Button type="submit" loading={fetcher.state !== 'idle'}>
              Registrer godkjenning for valgte commits
            </Button>
          </VStack>
        </fetcher.Form>
      )}
    </VStack>
  )
}

export interface RepositoryManualApprovalPageProps {
  repository: { id: number; githubOwner: string; githubRepoName: string }
  delivery: { id: number; base_sha: string; head_sha: string; first_deployed_at: Date | string | null }
  manualApprovalHistory: ManualApprovalHistoryEntry[]
}

export function RepositoryManualApprovalPage({
  repository,
  delivery,
  manualApprovalHistory,
}: RepositoryManualApprovalPageProps) {
  const fetcher = useFetcher<ApprovalActionData>()
  const review = fetcher.data?.review
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
        Godkjenningen gjelder bare valgte commits. Den endrer ikke deploymentstatus eller PR-regler. Review etter
        deployment er tillatt og vises som etterfølgende godkjenning, ikke som godkjent ved deploy.
      </Alert>
      {delivery.first_deployed_at && (
        <BodyShort>Første tilknyttede deployment: {formatAuditLogTimestamp(delivery.first_deployed_at)}</BodyShort>
      )}
      {delivery.base_sha.toLowerCase() === delivery.head_sha.toLowerCase() ? (
        <Alert variant="info">
          Dette er startpunktet for repositoryhistorikken. Leveransen har ikke et endringsintervall som kan godkjennes
          manuelt.
        </Alert>
      ) : (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="start-review" />
          <Button type="submit" variant={review ? 'secondary' : 'primary'} loading={fetcher.state !== 'idle'}>
            {review ? 'Start en ny gjennomgang med nytt grunnlag' : 'Start gjennomgang'}
          </Button>
        </fetcher.Form>
      )}
      <ActionAlert data={fetcher.data} />
      {review && (
        <>
          <RepositoryApprovalSnapshot repository={repository} review={review} />
          <RepositoryApprovalConfirmation key={review.snapshotId} review={review} />
        </>
      )}
      <RepositoryManualApprovalHistory
        repository={repository}
        entries={manualApprovalHistory}
        firstDeployedAt={delivery.first_deployed_at}
      />
    </VStack>
  )
}
