import { Link as AkselLink, BodyShort, Box, Button, Checkbox, Heading, VStack } from '@navikt/ds-react'
import { Link, useFetcher } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
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

export function CodeDeliveryTrackingSettings({
  repositoryId,
  githubOwner,
  githubRepoName,
  codeDeliveryTracking,
}: CodeDeliveryTrackingSettingsProps) {
  const { enabled, since, earliestDeploymentAt } = codeDeliveryTracking
  const toggleFetcher = useFetcher<{ success?: string; error?: string }>()
  const restartFetcher = useFetcher<{ success?: string; error?: string }>()

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Registrering av kodeleveranser
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Registrerer kodeleveranser fra hele deploymenthistorikken som er lagret i NDA, eldste først. Nødvendig
            vurderingsgrunnlag hentes fra GitHub i bakgrunnen. Eksisterende kodeleveranser og godkjenningsgrunnlag
            beholdes. Dette endrer ikke applikasjonsbasert vurdering og henter ikke eldre deployments fra Nais.
          </BodyShort>
        </div>

        <BodyShort size="small">
          {enabled ? 'På' : 'Av'}
          {since
            ? enabled
              ? ` — først slått på ${formatAuditLogTimestamp(since)}`
              : ` — tidligere slått på ${formatAuditLogTimestamp(since)}`
            : ''}
        </BodyShort>
        {earliestDeploymentAt && (
          <BodyShort size="small">
            Eldste lagrede deployment i repoet er fra {formatAuditLogTimestamp(earliestDeploymentAt)}.
          </BodyShort>
        )}

        <toggleFetcher.Form method="post" onSubmit={() => restartFetcher.reset()}>
          <input type="hidden" name="action" value="update_code_delivery_tracking" />
          <input type="hidden" name="repository_id" value={repositoryId} />
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <Button type="submit" size="small" variant="secondary" loading={toggleFetcher.state !== 'idle'}>
            {enabled ? 'Slå av' : 'Slå på'}
          </Button>
        </toggleFetcher.Form>
        <ActionAlert data={toggleFetcher.state === 'idle' ? toggleFetcher.data : null} />

        {enabled && (
          <restartFetcher.Form method="post" onSubmit={() => toggleFetcher.reset()}>
            <input type="hidden" name="action" value="restart_code_delivery_tracking" />
            <input type="hidden" name="repository_id" value={repositoryId} />
            <VStack gap="space-12">
              <div>
                <Heading size="xsmall" level="3">
                  Bygg registreringen på nytt
                </Heading>
                <BodyShort textColor="subtle" size="small">
                  Bruk bare dette for å reparere registreringen. De registrerte kodeleveransene for repoet slettes og
                  bygges opp på nytt fra hele den lagrede deploymenthistorikken. Dette er ikke nødvendig for å hente
                  eldre historikk. Omstart er ikke mulig når repoet har lagrede repositorygodkjenningsgrunnlag.
                  Applikasjonsbasert godkjenning, status og rapporter for deployments endres ikke.
                </BodyShort>
              </div>
              <Checkbox name="confirm" value="true" size="small" required>
                Jeg forstår at registreringen av kodeleveranser nullstilles og bygges opp på nytt. Godkjenning berøres
                ikke.
              </Checkbox>
              <div>
                <Button type="submit" size="small" variant="secondary" loading={restartFetcher.state !== 'idle'}>
                  Start på nytt
                </Button>
              </div>
            </VStack>
          </restartFetcher.Form>
        )}
        {enabled && <ActionAlert data={restartFetcher.state === 'idle' ? restartFetcher.data : null} />}

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
