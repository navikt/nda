import { Alert, BodyShort, Button, Checkbox, Heading, HStack, Table, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { ActionResult } from '~/lib/action-result'
import type { NaisHistoryRecoveryCandidate } from '~/lib/nais-history-recovery'
import { ActionAlert } from './ActionAlert'

interface NaisHistoryRecoveryPageProps {
  candidates: NaisHistoryRecoveryCandidate[]
  search: string
  actionData?: ActionResult | null
}

export function NaisHistoryRecoveryPage({ candidates, search, actionData }: NaisHistoryRecoveryPageProps) {
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
