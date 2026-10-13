import {
  Link as AkselLink,
  BodyShort,
  Box,
  Button,
  Checkbox,
  DatePicker,
  Heading,
  useDatepicker,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link } from 'react-router'
import { formatAuditLogTimestamp } from '~/lib/app-config-audit-log-display'

type CodeDeliveryTrackingSettingsProps = {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
  codeDeliveryTracking: {
    enabled: boolean
    since: Date | string | null
    earliestDeploymentAt: Date | string | null
  }
}

function formatDateValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function CodeDeliveryTrackingSettings({
  repositoryId,
  githubOwner,
  githubRepoName,
  codeDeliveryTracking,
}: CodeDeliveryTrackingSettingsProps) {
  const { enabled, since, earliestDeploymentAt } = codeDeliveryTracking
  const [sinceValue, setSinceValue] = useState('')
  const { datepickerProps, inputProps } = useDatepicker({
    toDate: since ? new Date(since) : new Date(),
    onDateChange: (date) => setSinceValue(date ? formatDateValue(date) : ''),
  })

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Registrering av kodeleveranser
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Registrerer leveranser for hele repoet i bakgrunnen. Dette påvirker ikke godkjenning av deployments. Bare
            deployments opprettet fra og med første gang registreringen ble slått på vurderes.
          </BodyShort>
        </div>

        <BodyShort size="small">
          {enabled ? 'På' : 'Av'}
          {since
            ? enabled
              ? ` — vurderer deployments fra ${formatAuditLogTimestamp(since)}`
              : ` — tidligere slått på ${formatAuditLogTimestamp(since)}`
            : ''}
        </BodyShort>

        <Form method="post">
          <input type="hidden" name="action" value="update_code_delivery_tracking" />
          <input type="hidden" name="repository_id" value={repositoryId} />
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <Button type="submit" size="small" variant="secondary">
            {enabled ? 'Slå av' : 'Slå på'}
          </Button>
        </Form>

        {enabled && (
          <Form method="post">
            <input type="hidden" name="action" value="restart_code_delivery_tracking" />
            <input type="hidden" name="repository_id" value={repositoryId} />
            <VStack gap="space-12">
              <div>
                <Heading size="xsmall" level="3">
                  Start på nytt fra tidligere dato
                </Heading>
                <BodyShort textColor="subtle" size="small">
                  Bruk dette for å ta med eldre deployments. Alle registrerte leveranser og uavklarte deployments for
                  repoet slettes, og registreringen bygges opp på nytt fra datoen, eldste først. Godkjenning av
                  deployments berøres ikke.
                  {earliestDeploymentAt
                    ? ` Eldste deployment i repoet er fra ${formatAuditLogTimestamp(earliestDeploymentAt)}.`
                    : ''}
                </BodyShort>
              </div>
              <input type="hidden" name="since" value={sinceValue} />
              <DatePicker {...datepickerProps}>
                <DatePicker.Input {...inputProps} label="Vurder deployments fra og med" size="small" />
              </DatePicker>
              <Checkbox name="confirm" value="true" size="small" required>
                Jeg forstår at registrerte leveranser for dette repoet slettes
              </Checkbox>
              <div>
                <Button type="submit" size="small" variant="secondary" disabled={!sinceValue}>
                  Start på nytt
                </Button>
              </div>
            </VStack>
          </Form>
        )}

        <BodyShort size="small">
          <AkselLink
            as={Link}
            to={`/repository/${githubOwner}/${githubRepoName}/admin/code-deliveries?repositoryId=${repositoryId}`}
          >
            Se registrerte leveranser →
          </AkselLink>
        </BodyShort>
      </VStack>
    </Box>
  )
}
