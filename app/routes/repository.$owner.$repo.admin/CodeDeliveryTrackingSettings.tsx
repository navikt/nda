import { BodyShort, Box, Button, Heading, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'

type CodeDeliveryTrackingSettingsProps = {
  repositoryId: number
  codeDeliveryTracking: { enabled: boolean; since: Date | string | null }
}

export function CodeDeliveryTrackingSettings({
  repositoryId,
  codeDeliveryTracking,
}: CodeDeliveryTrackingSettingsProps) {
  const { enabled, since } = codeDeliveryTracking

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Registrering av kodeleveranser
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Registrerer leveranser for hele repoet i bakgrunnen. Dette påvirker ikke godkjenning av deployments. Bare
            deployments opprettet etter at registreringen ble slått på vurderes.
          </BodyShort>
        </div>

        <BodyShort size="small">
          {enabled ? 'På' : 'Av'}
          {since ? ` — vurderer deployments fra ${formatAuditLogTimestamp(since)}` : ''}
        </BodyShort>

        <Form method="post">
          <input type="hidden" name="action" value="update_code_delivery_tracking" />
          <input type="hidden" name="repository_id" value={repositoryId} />
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <Button type="submit" size="small" variant="secondary">
            {enabled ? 'Slå av' : 'Slå på'}
          </Button>
        </Form>
      </VStack>
    </Box>
  )
}
