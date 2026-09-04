import { Box, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import { RepoScopeSaveButton, RepoScopeWarning } from '~/components/RepoScopeSettings'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type AuditStartYearSettingsProps = {
  app: LoaderData['app']
  auditStartYear: LoaderData['auditStartYear']
  affectedApps: LoaderData['affectedApps']
}

const FORM_ID = 'audit-start-year-form'

export function AuditStartYearSettings({ app, auditStartYear, affectedApps }: AuditStartYearSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Startår for revisjon
        </Heading>
        <RepoScopeWarning affectedApps={affectedApps} currentAppId={app.id} />
        <Form method="post" id={FORM_ID}>
          <input type="hidden" name="action" value="update_audit_start_year" />
          <input type="hidden" name="app_id" value={app.id} />
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
            <RepoScopeSaveButton
              affectedApps={affectedApps}
              currentAppId={app.id}
              formId={FORM_ID}
              settingLabel="startår for revisjon"
            />
          </HStack>
        </Form>
      </VStack>
    </Box>
  )
}
