import { Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type AuditStartYearSettingsProps = {
  app: LoaderData['app']
}

export function AuditStartYearSettings({ app }: AuditStartYearSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Startår for revisjon
        </Heading>
        <Form method="post">
          <input type="hidden" name="action" value="update_audit_start_year" />
          <input type="hidden" name="app_id" value={app.id} />
          <HStack gap="space-16" align="end" wrap>
            <TextField
              label="År"
              description="Deployments før dette året ignoreres i statistikk og rapporter"
              name="audit_start_year"
              type="number"
              defaultValue={app.audit_start_year ?? ''}
              size="small"
              style={{ minWidth: '120px' }}
            />
            <Button type="submit" size="small" variant="secondary">
              Lagre
            </Button>
          </HStack>
        </Form>
      </VStack>
    </Box>
  )
}
