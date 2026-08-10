import { ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'

const MESSAGE =
  'Applikasjonen ble ikke funnet i Nais under siste synkronisering. Den kan være omdøpt, flyttet eller avviklet.'

interface NotFoundInNaisNoticeProps {
  variant: 'alert' | 'panel'
  canDeactivate: boolean
  appId?: number
}

export function NotFoundInNaisNotice({ variant, canDeactivate, appId }: NotFoundInNaisNoticeProps) {
  const deactivateButton = canDeactivate ? (
    <Form method="post">
      <input type="hidden" name="action" value="deactivate_app" />
      {appId !== undefined && <input type="hidden" name="app_id" value={appId} />}
      <Button type="submit" variant="danger" size="small">
        Deaktiver applikasjon
      </Button>
    </Form>
  ) : (
    <BodyShort size="small" textColor="subtle">
      Kontakt en produktleder, tech lead eller administrator for å deaktivere applikasjonen.
    </BodyShort>
  )

  if (variant === 'panel') {
    return (
      <Box padding="space-24" borderRadius="8" background="danger-softA" borderColor="danger" borderWidth="1">
        <VStack gap="space-16">
          <HStack gap="space-8" align="center">
            <ExclamationmarkTriangleIcon aria-hidden fontSize="1.5rem" />
            <Heading size="small" level="2">
              Finnes ikke i Nais
            </Heading>
          </HStack>
          <BodyShort textColor="subtle" size="small">
            {MESSAGE} Deaktiver den her hvis den ikke lenger skal overvåkes.
          </BodyShort>
          {deactivateButton}
        </VStack>
      </Box>
    )
  }

  return (
    <Alert variant="error">
      <VStack gap="space-8">
        <BodyShort>{MESSAGE}</BodyShort>
        {deactivateButton}
      </VStack>
    </Alert>
  )
}
