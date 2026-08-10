import { CheckmarkCircleIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Heading, HStack, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'

interface ReactivateAppNoticeProps {
  canReactivate: boolean
  appId?: number
}

export function ReactivateAppNotice({ canReactivate, appId }: ReactivateAppNoticeProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="neutral-softA" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <HStack gap="space-8" align="center">
          <CheckmarkCircleIcon aria-hidden fontSize="1.5rem" />
          <Heading size="small" level="2">
            Applikasjonen er deaktivert
          </Heading>
        </HStack>
        <BodyShort textColor="subtle" size="small">
          Applikasjonen overvåkes ikke lenger. Hvis den har dukket opp igjen i Nais, kan du reaktivere overvåkingen her.
        </BodyShort>
        {canReactivate ? (
          <Form method="post">
            <input type="hidden" name="action" value="reactivate_app" />
            {appId !== undefined && <input type="hidden" name="app_id" value={appId} />}
            <Button type="submit" variant="secondary" size="small">
              Reaktiver applikasjon
            </Button>
          </Form>
        ) : (
          <BodyShort size="small" textColor="subtle">
            Kontakt en teamleder, seksjonsleder eller administrator for å reaktivere applikasjonen.
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}
