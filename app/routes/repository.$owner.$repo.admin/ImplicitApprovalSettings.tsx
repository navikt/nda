import { BodyShort, Box, Button, Heading, Select, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { AffectedApp } from '~/db/repositories.server'
import {
  IMPLICIT_APPROVAL_MODE_DESCRIPTIONS,
  IMPLICIT_APPROVAL_MODE_LABELS,
  IMPLICIT_APPROVAL_MODES,
} from '~/lib/verification/types'
import { AffectedAppsList } from './AffectedAppsList'

type ImplicitApprovalSettingsProps = {
  repositoryId: number
  implicitApprovalSettings: { mode: string }
  affectedApps: AffectedApp[]
}

export function ImplicitApprovalSettings({
  repositoryId,
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

        <Form method="post">
          <input type="hidden" name="action" value="update_implicit_approval" />
          <input type="hidden" name="repository_id" value={repositoryId} />
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
              <Button type="submit" size="small" variant="secondary">
                Lagre innstillinger
              </Button>
            </div>
          </VStack>
        </Form>

        <AffectedAppsList affectedApps={affectedApps} />
      </VStack>
    </Box>
  )
}
