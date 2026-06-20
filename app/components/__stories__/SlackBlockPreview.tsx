import { ExternalLinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, HStack, VStack } from '@navikt/ds-react'
import type { KnownBlock } from '@slack/types'
import { buildBlockKitBuilderUrl, isUrlTooLong } from '~/lib/slack'

interface SlackBlockPreviewProps {
  blocks: KnownBlock[]
  mode?: 'message' | 'modal'
}

export function SlackBlockPreview({ blocks, mode = 'message' }: SlackBlockPreviewProps) {
  const url = buildBlockKitBuilderUrl(blocks, mode)
  const tooLong = isUrlTooLong(url)
  const jsonSize = new Blob([JSON.stringify({ blocks })]).size

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <HStack gap="space-16" align="center" justify="space-between">
          <Button
            as="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            variant="primary"
            icon={<ExternalLinkIcon aria-hidden />}
            iconPosition="right"
          >
            Åpne i Block Kit Builder
          </Button>
          <Detail textColor="subtle">
            {blocks.length} blokker · {(jsonSize / 1024).toFixed(1)} KB
          </Detail>
        </HStack>

        {tooLong && (
          <Alert variant="warning" size="small">
            URL-en er over 16 KB og kan være for lang for Block Kit Builder. Vurder å redusere antall blokker.
          </Alert>
        )}

        <Box padding="space-16" borderRadius="4" background="sunken">
          <BodyShort
            as="pre"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.75rem', margin: 0 }}
          >
            {JSON.stringify({ blocks }, null, 2)}
          </BodyShort>
        </Box>
      </VStack>
    </Box>
  )
}
