import { Accordion, BodyShort, Button, Heading, Table, Tag, Textarea, VStack } from '@navikt/ds-react'
import { useFetcher } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'
import { isDocumentationUrl } from '~/lib/repository-manual-approval'

export interface ManualApprovalHistoryEntry {
  id: number
  reviewer: string
  registeredBy: string
  reviewedAt: Date | string
  registeredAt: Date | string
  reviewDocumentation?: string | null
  documentationUrl?: string | null
  baseSha: string
  headSha: string
  commits: Array<{
    sha: string
    authorLogin: string | null
    authorNavIdent: string | null
    status: 'eligible' | 'revoked' | 'identity_or_interval_changed'
  }>
  events: Array<{
    type: 'created' | 'revoked'
    actor: string
    reason: string | null
    at: Date | string
  }>
}

function RevokeApproval({ approvalId, revoked }: { approvalId: number; revoked: boolean }) {
  const fetcher = useFetcher()
  return (
    <VStack gap="space-12">
      <ActionAlert data={fetcher.data} />
      {!revoked && (
        <fetcher.Form method="post">
          <VStack gap="space-12">
            <input type="hidden" name="intent" value="revoke-approval" />
            <input type="hidden" name="approvalId" value={approvalId} />
            <Textarea name="reason" label="Begrunnelse for tilbakekalling" aria-required />
            <Button type="submit" variant="secondary" data-color="danger" loading={fetcher.state !== 'idle'}>
              Tilbakekall godkjenningen
            </Button>
          </VStack>
        </fetcher.Form>
      )}
    </VStack>
  )
}

export function RepositoryManualApprovalHistory({
  repository,
  entries,
  canRevoke = false,
  firstDeployedAt,
}: {
  repository: { githubOwner: string; githubRepoName: string }
  entries: ManualApprovalHistoryEntry[]
  canRevoke?: boolean
  firstDeployedAt?: Date | string | null
}) {
  return (
    <section aria-labelledby="manual-approval-history-heading">
      <Heading id="manual-approval-history-heading" level="2" size="small" spacing>
        Manuelle repositorygodkjenninger
      </Heading>
      <BodyShort size="small" spacing>
        Historikken gjelder dette leveranseintervallet. Gyldig identitet og intervall er ikke alene tilstrekkelig for
        dekning; gjeldende PR-grunnlag må også være kjent og author-identiteten må samsvare. Author-identitetene
        nedenfor er lagret ved opprettelse av godkjenningsgrunnlaget, ikke hentet fra dagens kontokoblinger.
      </BodyShort>
      {entries.length === 0 ? (
        <BodyShort textColor="subtle">Ingen manuelle repositorygodkjenninger er registrert.</BodyShort>
      ) : (
        <Accordion>
          {entries.map((entry) => (
            <Accordion.Item key={entry.id}>
              <Accordion.Header>
                Gjennomgått av {entry.reviewer} · {formatAuditLogTimestamp(entry.reviewedAt)}
                {firstDeployedAt &&
                  new Date(entry.reviewedAt).getTime() > new Date(firstDeployedAt).getTime() &&
                  ' · Etterfølgende godkjenning'}
              </Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-16">
                  <BodyShort size="small">
                    Registrert av {entry.registeredBy} · {formatAuditLogTimestamp(entry.registeredAt)}
                  </BodyShort>
                  {firstDeployedAt && new Date(entry.registeredAt).getTime() > new Date(firstDeployedAt).getTime() && (
                    <Tag variant="outline" data-color="warning">
                      Registrert etter første deploy
                    </Tag>
                  )}
                  {firstDeployedAt && new Date(entry.reviewedAt).getTime() > new Date(firstDeployedAt).getTime() && (
                    <Tag variant="outline" data-color="warning">
                      Etterfølgende godkjenning – ikke godkjent ved første deploy
                    </Tag>
                  )}
                  <BodyShort size="small">
                    Hva som er gjennomgått:{' '}
                    {entry.reviewDocumentation ?? 'Ikke dokumentert i den gamle registreringen.'}
                  </BodyShort>
                  {entry.documentationUrl && isDocumentationUrl(entry.documentationUrl) && (
                    <ExternalLink href={entry.documentationUrl}>Ytterligere dokumentasjon</ExternalLink>
                  )}
                  <BodyShort size="small">
                    Lagret intervall: <code>{entry.baseSha}</code> → <code>{entry.headSha}</code>
                  </BodyShort>
                  <Table size="small">
                    <caption className="aksel-sr-only">Commits i delgodkjenningen fra {entry.reviewer}</caption>
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell>Commit</Table.HeaderCell>
                        <Table.HeaderCell>Lagret author-identitet</Table.HeaderCell>
                        <Table.HeaderCell>Identitet og intervall</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {entry.commits.map((commit) => (
                        <Table.Row key={commit.sha}>
                          <Table.DataCell>
                            <ExternalLink
                              href={`https://github.com/${repository.githubOwner}/${repository.githubRepoName}/commit/${commit.sha}`}
                            >
                              <code>{commit.sha}</code>
                            </ExternalLink>
                          </Table.DataCell>
                          <Table.DataCell>
                            {commit.authorLogin ? (
                              <UserName username={commit.authorLogin} userMappings={{}} link={false} />
                            ) : (
                              'Ukjent'
                            )}
                            {' · '}
                            {commit.authorNavIdent ?? 'Ukjent NAV-ident'}
                          </Table.DataCell>
                          <Table.DataCell>
                            <Tag
                              size="small"
                              variant="outline"
                              data-color={commit.status === 'eligible' ? 'neutral' : 'warning'}
                            >
                              {commit.status === 'eligible'
                                ? 'Gyldig identitet og intervall'
                                : commit.status === 'revoked'
                                  ? 'Tilbakekalt'
                                  : 'Identitet eller intervall endret'}
                            </Tag>
                          </Table.DataCell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                  {entry.events.map((event) => (
                    <BodyShort key={event.type} size="small">
                      {event.type === 'created' ? 'Opprettet' : 'Tilbakekalt'} av {event.actor} ·{' '}
                      {formatAuditLogTimestamp(event.at)}
                      {event.reason ? ` · Begrunnelse: ${event.reason}` : ''}
                    </BodyShort>
                  ))}
                  {canRevoke && (
                    <RevokeApproval
                      approvalId={entry.id}
                      revoked={entry.events.some((event) => event.type === 'revoked')}
                    />
                  )}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </section>
  )
}
