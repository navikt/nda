import { Alert, BodyShort, Box, Button, Heading, Switch, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'

type NaisApplySettingsProps = {
  appId: number
  enabled: boolean
  syncState: {
    initialHistorySyncedAt: string | null
    lastSyncedAt: string | null
    hasError: boolean
  }
}

export function NaisApplySettings({ appId, enabled, syncState }: NaisApplySettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Nais Apply
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Hent leveranser fra Nais aktivitetslogg for denne appen. Legacy-deployments synkroniseres fortsatt uavhengig
            av denne innstillingen.
          </BodyShort>
        </div>

        <Form method="post">
          <input type="hidden" name="action" value="update_nais_apply_setting" />
          <input type="hidden" name="app_id" value={appId} />
          <VStack gap="space-16">
            <Switch name="nais_apply_enabled" value="true" defaultChecked={enabled}>
              Aktiver Nais Apply-synkronisering for denne appen
            </Switch>

            <Button type="submit" size="small" variant="secondary">
              Lagre Nais Apply-innstilling
            </Button>
          </VStack>
        </Form>
        {enabled && syncState.hasError && (
          <Alert variant="error">Siste Nais Apply-synk feilet. Se applikasjonsloggene for detaljer.</Alert>
        )}
        {enabled && !syncState.initialHistorySyncedAt && !syncState.hasError && (
          <Alert variant="info">Første fullstendige historikksynk er ikke fullført ennå.</Alert>
        )}
        {enabled && syncState.lastSyncedAt && (
          <BodyShort textColor="subtle" size="small">
            Sist synkronisert:{' '}
            {new Date(syncState.lastSyncedAt).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' })}
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}
