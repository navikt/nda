import { BodyShort, Box, Heading, Select, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import { RepoScopeSaveButton, RepoScopeWarning } from '~/components/RepoScopeSettings'
import {
  IMPLICIT_APPROVAL_MODE_DESCRIPTIONS,
  IMPLICIT_APPROVAL_MODE_LABELS,
  IMPLICIT_APPROVAL_MODES,
} from '~/lib/verification/types'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']
export type ImplicitApprovalSettingsProps = {
  app: LoaderData['app']
  implicitApprovalSettings: LoaderData['implicitApprovalSettings']
  affectedApps: LoaderData['affectedApps']
}

const FORM_ID = 'implicit-approval-form'

export function ImplicitApprovalSettings({
  app,
  implicitApprovalSettings,
  affectedApps,
}: ImplicitApprovalSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Implisitt godkjenning
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Godkjenner automatisk en PR hvis den som merger ikke er PR-oppretteren og ikke har siste commit.
          </BodyShort>
        </div>

        <RepoScopeWarning affectedApps={affectedApps} currentAppId={app.id} />

        <Form method="post" id={FORM_ID}>
          <input type="hidden" name="action" value="update_implicit_approval" />
          <input type="hidden" name="app_id" value={app.id} />
          <VStack gap="space-12">
            <Select
              label="Modus"
              name="mode"
              defaultValue={implicitApprovalSettings.mode}
              size="small"
              style={{ maxWidth: '300px' }}
            >
              {IMPLICIT_APPROVAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {IMPLICIT_APPROVAL_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>

            <BodyShort size="small" textColor="subtle">
              <strong>{IMPLICIT_APPROVAL_MODE_LABELS.dependabot_only}:</strong>{' '}
              {IMPLICIT_APPROVAL_MODE_DESCRIPTIONS.dependabot_only}.
              <br />
              <strong>{IMPLICIT_APPROVAL_MODE_LABELS.all}:</strong> {IMPLICIT_APPROVAL_MODE_DESCRIPTIONS.all}.
            </BodyShort>

            <div>
              <RepoScopeSaveButton
                affectedApps={affectedApps}
                currentAppId={app.id}
                formId={FORM_ID}
                settingLabel="implisitt godkjenning"
                label="Lagre innstillinger"
              />
            </div>
          </VStack>
        </Form>
      </VStack>
    </Box>
  )
}
