import { Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { AffectedApp } from '~/db/repositories.server'
import { AffectedAppsList } from './AffectedAppsList'

type AuditStartYearSettingsProps = {
  repositoryId: number
  auditStartYear: number | null
  affectedApps: AffectedApp[]
}

export function AuditStartYearSettings({ repositoryId, auditStartYear, affectedApps }: AuditStartYearSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Startår for revisjon
        </Heading>
        <Form method="post">
          <input type="hidden" name="action" value="update_audit_start_year" />
          <input type="hidden" name="repository_id" value={repositoryId} />
          <HStack gap="space-16" align="end" wrap>
            <TextField
              label="År"
              description="Deployments før dette året ignoreres i statistikk og rapporter"
              name="audit_start_year"
              type="number"
              defaultValue={auditStartYear ?? ''}
              size="small"
              style={{ minWidth: '120px' }}
            />
            <Button type="submit" size="small" variant="secondary">
              Lagre
            </Button>
          </HStack>
        </Form>
        <AffectedAppsList affectedApps={affectedApps} />
      </VStack>
    </Box>
  )
}
