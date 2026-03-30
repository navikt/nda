import { ExclamationmarkTriangleIcon, InformationSquareIcon, XMarkOctagonIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Button, Detail, HStack, Loader, Tag, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { useFetcher } from 'react-router'

type Annotation = {
  path: string | null
  start_line: number
  end_line: number
  start_column: number | null
  end_column: number | null
  annotation_level: string
  message: string
  title: string | null
  raw_details: string | null
}

export function CheckAnnotations({
  owner,
  repo,
  checkRunId,
  storedAnnotations,
}: {
  owner: string
  repo: string
  checkRunId: number
  storedAnnotations: Annotation[] | null
}) {
  const fetcher = useFetcher<{ annotations?: Annotation[]; error?: string }>()
  const [showAnnotations, setShowAnnotations] = useState(false)

  const annotations = storedAnnotations ?? fetcher.data?.annotations ?? null

  const ensureLoaded = () => {
    if (!storedAnnotations && fetcher.state === 'idle' && !fetcher.data) {
      fetcher.load(`/api/checks/annotations?owner=${owner}&repo=${repo}&check_run_id=${checkRunId}`)
    }
  }

  const levelIcon = (level: string) => {
    switch (level) {
      case 'failure':
        return <XMarkOctagonIcon style={{ color: 'var(--ax-text-danger)', flexShrink: 0 }} />
      case 'warning':
        return <ExclamationmarkTriangleIcon style={{ color: 'var(--ax-text-warning)', flexShrink: 0 }} />
      default:
        return <InformationSquareIcon style={{ color: 'var(--ax-text-info)', flexShrink: 0 }} />
    }
  }

  const levelVariant = (level: string): 'error' | 'warning' | 'info' => {
    switch (level) {
      case 'failure':
        return 'error'
      case 'warning':
        return 'warning'
      default:
        return 'info'
    }
  }

  return (
    <VStack gap="space-4" style={{ paddingLeft: 'var(--ax-space-24)' }}>
      <HStack gap="space-8" align="center">
        <Button
          variant="tertiary"
          size="xsmall"
          onClick={() => {
            setShowAnnotations(!showAnnotations)
            if (!showAnnotations) ensureLoaded()
          }}
        >
          {showAnnotations ? 'Skjul annotations' : 'Vis annotations'}
        </Button>
      </HStack>
      {showAnnotations && (
        <>
          {fetcher.state === 'loading' && <Loader size="small" />}
          {fetcher.data?.error && (
            <Alert variant="warning" size="small">
              {fetcher.data.error}
            </Alert>
          )}
          {annotations && annotations.length > 0 && (
            <VStack gap="space-8">
              {annotations.map((a) => (
                <HStack key={`${a.path}-${a.start_line}-${a.message}`} gap="space-8" align="start" wrap>
                  {levelIcon(a.annotation_level)}
                  <VStack gap="space-2" style={{ flex: 1, minWidth: 0 }}>
                    <HStack gap="space-8" align="center" wrap>
                      <Tag variant={levelVariant(a.annotation_level)} size="small">
                        {a.annotation_level}
                      </Tag>
                      {a.path && (
                        <Detail textColor="subtle">
                          {a.path}
                          {a.start_line ? `:${a.start_line}` : ''}
                          {a.end_line && a.end_line !== a.start_line ? `-${a.end_line}` : ''}
                        </Detail>
                      )}
                    </HStack>
                    {a.title && (
                      <BodyShort size="small" weight="semibold">
                        {a.title}
                      </BodyShort>
                    )}
                    <BodyShort size="small" style={{ whiteSpace: 'pre-wrap' }}>
                      {a.message}
                    </BodyShort>
                  </VStack>
                </HStack>
              ))}
            </VStack>
          )}
          {annotations && annotations.length === 0 && <Detail textColor="subtle">Ingen annotations funnet.</Detail>}
        </>
      )}
    </VStack>
  )
}
