import { Alert, BodyShort, Button, Checkbox, Heading, HStack, Table, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { ActionResult } from '~/lib/action-result'
import type { CompletedNaisSyncInWindow, NaisHistoryRecoveryCandidate } from '~/lib/nais-history-recovery'
import { ActionAlert } from './ActionAlert'

interface NaisHistoryRecoveryPageProps {
  candidates: NaisHistoryRecoveryCandidate[]
  search: string
  from?: string
  to?: string
  windowSyncs?: CompletedNaisSyncInWindow[] | null
  windowError?: string | null
  actionData?: ActionResult | null
}

export function NaisHistoryRecoveryPage({
  candidates,
  search,
  from = '',
  to = '',
  windowSyncs = null,
  windowError = null,
  actionData,
}: NaisHistoryRecoveryPageProps) {
  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Gjenopprett Nais-historikk
        </Heading>
        <BodyShort>
          Nullstill markøren for én applikasjon for å be den periodiske synkroniseringen hente hele Nais-historikken på
          nytt. Synkroniseringen skjer når neste periodiske kjøring er klar etter eventuell pågående jobb og nedkjøling.
        </BodyShort>
      </div>

      <Alert variant="warning">
        Full gjennomgang kan gjenta repository-kontroller og varsler for eksisterende leveranser. Den oppretter ikke
        duplikate leveranser. Bruk dette bare for applikasjoner som mistenkes å mangle historikk.
      </Alert>

      <ActionAlert data={actionData} />

      <Form method="get" role="search">
        <HStack gap="space-12" align="end">
          <TextField label="Søk etter team, miljø eller applikasjon" name="q" defaultValue={search} size="small" />
          <Button type="submit" variant="secondary" size="small">
            Søk
          </Button>
        </HStack>
      </Form>

      <Form method="get" role="search">
        <input type="hidden" name="q" value={search} />
        <VStack gap="space-12">
          <Heading level="2" size="medium">
            Fullførte NAIS-synker i tidsrom
          </Heading>
          <BodyShort>
            Viser fullførte NAIS-synkjobber startet i tidsrommet, for eksempel mellom to produksjonssettinger, for å
            finne kandidater.
          </BodyShort>
          <HStack gap="space-12" align="end">
            <TextField
              label="Fra"
              name="from"
              description="F.eks. 2026-01-14T10:00:00+01:00"
              defaultValue={from}
              size="small"
            />
            <TextField
              label="Til"
              name="to"
              description="F.eks. 2026-01-14T10:00:00+01:00"
              defaultValue={to}
              size="small"
            />
            <Button type="submit" variant="secondary" size="small">
              Vis synker
            </Button>
          </HStack>
        </VStack>
      </Form>

      {windowError && <Alert variant="error">{windowError}</Alert>}
      {windowSyncs &&
        (windowSyncs.length === 0 ? (
          <Alert variant="info">Fant ingen fullførte NAIS-synker i tidsrommet.</Alert>
        ) : (
          <Table size="small">
            <caption className="aksel-sr-only">Fullførte NAIS-synker i valgt tidsrom</caption>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Historikk fullført</Table.HeaderCell>
                <Table.HeaderCell scope="col">Startet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Fullført</Table.HeaderCell>
                <Table.HeaderCell scope="col">Versjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Resultat</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {windowSyncs.map((sync) => (
                <Table.Row key={`${sync.app_id}-${String(sync.started_at)}`}>
                  <Table.HeaderCell scope="row">
                    {sync.team_slug}/{sync.environment_name}/{sync.app_name}
                  </Table.HeaderCell>
                  <Table.DataCell>
                    {sync.initial_nais_history_synced_at ? formatDate(sync.initial_nais_history_synced_at) : 'Venter'}
                  </Table.DataCell>
                  <Table.DataCell>{formatDate(sync.started_at)}</Table.DataCell>
                  <Table.DataCell>{sync.completed_at ? formatDate(sync.completed_at) : '–'}</Table.DataCell>
                  <Table.DataCell>{sync.app_version ?? 'Ukjent'}</Table.DataCell>
                  <Table.DataCell>
                    <code>{sync.result ? JSON.stringify(sync.result) : '–'}</code>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        ))}
      {windowSyncs?.length === 500 && (
        <BodyShort textColor="subtle">Viser maksimalt 500 synker. Begrens tidsrommet.</BodyShort>
      )}

      {candidates.length === 0 ? (
        <Alert variant="info">
          Fant ingen aktive applikasjoner med fullført historikksynk som samsvarer med søket.
        </Alert>
      ) : (
        <Table size="small">
          <caption className="aksel-sr-only">Aktive applikasjoner med fullført Nais-historikksynk</caption>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
              <Table.HeaderCell scope="col">Historikk fullført</Table.HeaderCell>
              <Table.HeaderCell scope="col">Siste NAIS-synk</Table.HeaderCell>
              <Table.HeaderCell scope="col">Versjon</Table.HeaderCell>
              <Table.HeaderCell scope="col">Handling</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {candidates.map((candidate) => (
              <Table.Row key={candidate.id}>
                <Table.HeaderCell scope="row">
                  {candidate.team_slug}/{candidate.environment_name}/{candidate.app_name}
                </Table.HeaderCell>
                <Table.DataCell>{formatDate(candidate.initial_nais_history_synced_at)}</Table.DataCell>
                <Table.DataCell>
                  {candidate.latest_sync_started_at
                    ? `${getSyncStatusLabel(candidate)} · ${formatDate(candidate.latest_sync_started_at)}`
                    : 'Ingen registrert synk'}
                </Table.DataCell>
                <Table.DataCell>{candidate.latest_sync_version ?? 'Ukjent'}</Table.DataCell>
                <Table.DataCell>
                  {candidate.latest_sync_is_active ? (
                    <BodyShort>Synkronisering pågår</BodyShort>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="id" value={candidate.id} />
                      <input type="hidden" name="intent" value="reset_history_marker" />
                      <VStack gap="space-8">
                        <Checkbox name="confirmed" value="yes" required size="small">
                          Jeg bekrefter full historikksynk
                        </Checkbox>
                        <Button type="submit" variant="danger" size="small">
                          Nullstill markør
                        </Button>
                      </VStack>
                    </Form>
                  )}
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      {candidates.length === 100 && (
        <BodyShort textColor="subtle">Viser maksimalt 100 treff. Begrens resultatet med søk.</BodyShort>
      )}
    </VStack>
  )
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString('nb-NO')
}

function getSyncStatusLabel(candidate: NaisHistoryRecoveryCandidate): string {
  if (candidate.latest_sync_status === 'running' && !candidate.latest_sync_is_active) return 'utløpt'
  return candidate.latest_sync_status ?? 'ukjent'
}
