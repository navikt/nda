import { ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import type { Route } from '../+types/$id'

type LoaderData = Route.ComponentProps['loaderData']

export type LegacyPendingApprovalProps = {
  legacyInfo: LoaderData['legacyInfo']
  capabilities: LoaderData['capabilities']
}

export function LegacyPendingApproval({ legacyInfo, capabilities }: LegacyPendingApprovalProps) {
  return (
    <Box background="warning-moderate" padding="space-24" borderRadius="8">
      <VStack gap="space-16">
        <Heading size="small" level="3">
          <ExclamationmarkTriangleIcon aria-hidden /> Venter på godkjenning
        </Heading>
        <BodyShort>
          Info ble registrert av <strong>{legacyInfo?.registered_by}</strong> den{' '}
          {legacyInfo?.created_at
            ? new Date(legacyInfo.created_at).toLocaleDateString('no-NO', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'ukjent dato'}
          .
        </BodyShort>
        {legacyInfo?.comment_text && <BodyShort style={{ fontStyle: 'italic' }}>"{legacyInfo.comment_text}"</BodyShort>}
        {legacyInfo?.slack_link && (
          <BodyShort size="small">
            <ExternalLink href={legacyInfo.slack_link}>Se Slack-melding</ExternalLink>
          </BodyShort>
        )}
        <Alert variant="info" size="small">
          En annen person enn {legacyInfo?.registered_by} må godkjenne.
        </Alert>

        {capabilities.canApprove ? (
          <HStack gap="space-16" wrap>
            <Form method="post">
              <input type="hidden" name="intent" value="approve_legacy" />
              <Button type="submit" variant="primary" size="small">
                Godkjenn
              </Button>
            </Form>

            <Form method="post">
              <input type="hidden" name="intent" value="reject_legacy" />
              <VStack gap="space-16">
                <TextField label="Begrunnelse (valgfritt)" name="reason" size="small" />
                <Button type="submit" variant="danger" size="small">
                  Avvis
                </Button>
              </VStack>
            </Form>
          </HStack>
        ) : (
          <Alert variant="info" size="small">
            Du har ikke tilgang til å godkjenne eller avvise.
          </Alert>
        )}
      </VStack>
    </Box>
  )
}
