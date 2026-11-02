import { Link as AkselLink, BodyShort, Box, Button, Heading, VStack } from '@navikt/ds-react'
import { Link, useFetcher } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'

type CodeDeliveryTrackingSettingsProps = {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
  codeDeliveryTracking: {
    enabled: boolean
    since: Date | string | null
  }
}

export function CodeDeliveryTrackingSettings({
  repositoryId,
  githubOwner,
  githubRepoName,
  codeDeliveryTracking,
}: CodeDeliveryTrackingSettingsProps) {
  const { enabled } = codeDeliveryTracking
  const toggleFetcher = useFetcher<{ success?: string; error?: string }>()

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Registrering av kodeleveranser
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Registrerer leveranser for hele repoet i bakgrunnen, inkludert eldre deployments fra den tilgjengelige
            historikken. Eksisterende godkjenninger av deployments endres ikke.
          </BodyShort>
        </div>

        <BodyShort size="small">{enabled ? 'På' : 'Av'}</BodyShort>

        <toggleFetcher.Form method="post">
          <input type="hidden" name="action" value="update_code_delivery_tracking" />
          <input type="hidden" name="repository_id" value={repositoryId} />
          <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
          <Button type="submit" size="small" variant="secondary" loading={toggleFetcher.state !== 'idle'}>
            {enabled ? 'Slå av' : 'Slå på'}
          </Button>
        </toggleFetcher.Form>
        <ActionAlert data={toggleFetcher.state === 'idle' ? toggleFetcher.data : null} />

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
