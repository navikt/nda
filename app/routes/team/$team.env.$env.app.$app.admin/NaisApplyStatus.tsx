import { Alert, BodyShort, Box, Heading, VStack } from '@navikt/ds-react'

type NaisApplyStatusProps = {
  syncState: {
    initialHistorySyncedAt: string | null
    lastSyncedAt: string | null
    hasError: boolean
  }
}

export function NaisApplyStatus({ syncState }: NaisApplyStatusProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Nais Apply
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Leveranser hentes fra Nais aktivitetslogg. Legacy-deployments synkroniseres fortsatt parallelt.
          </BodyShort>
        </div>

        {syncState.hasError && (
          <Alert variant="error">Siste Nais Apply-synk feilet. Se applikasjonsloggene for detaljer.</Alert>
        )}
        {!syncState.initialHistorySyncedAt && !syncState.hasError && (
          <Alert variant="info">Første fullstendige historikksynk er ikke fullført ennå.</Alert>
        )}
        {syncState.lastSyncedAt && (
          <BodyShort textColor="subtle" size="small">
            Sist synkronisert:{' '}
            {new Date(syncState.lastSyncedAt).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' })}
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}
