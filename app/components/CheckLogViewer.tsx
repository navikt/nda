import { DownloadIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, HStack, Loader, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { useFetcher } from 'react-router'

interface CheckLogViewerProps {
  owner: string
  repo: string
  jobId: number
  appSlug: string | null
  conclusion: string | null
}

function getNoLogsReason(appSlug: string | null, conclusion: string | null): string | null {
  if (conclusion === 'skipped') {
    return 'Sjekken ble hoppet over og har ingen logg.'
  }
  if (appSlug !== null && appSlug !== 'github-actions') {
    return 'Denne sjekken er ikke en GitHub Actions-jobb og har ikke nedlastbare logger.'
  }
  return null
}

export function CheckLogViewer({ owner, repo, jobId, appSlug, conclusion }: CheckLogViewerProps) {
  const noLogsReason = getNoLogsReason(appSlug, conclusion)
  const fetcher = useFetcher<{ logs?: string; error?: string; errorType?: string; source?: string }>()
  const [showLogs, setShowLogs] = useState(false)
  const [pendingDownload, setPendingDownload] = useState(false)

  const ensureLogsLoaded = () => {
    if (fetcher.state === 'idle' && !fetcher.data) {
      fetcher.load(`/api/checks/logs?owner=${owner}&repo=${repo}&job_id=${jobId}`)
    }
  }

  const triggerDownload = (logs: string) => {
    const blob = new Blob([logs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${owner}-${repo}-${jobId}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadLogs = () => {
    if (fetcher.data?.logs) {
      triggerDownload(fetcher.data.logs)
    } else {
      setPendingDownload(true)
      ensureLogsLoaded()
    }
  }

  if (pendingDownload && fetcher.data?.logs) {
    setPendingDownload(false)
    triggerDownload(fetcher.data.logs)
  }

  if (noLogsReason) {
    return (
      <Box style={{ paddingLeft: 'var(--ax-space-24)' }}>
        <BodyShort size="small" textColor="subtle">
          {noLogsReason}
        </BodyShort>
      </Box>
    )
  }

  return (
    <VStack gap="space-4" style={{ paddingLeft: 'var(--ax-space-24)' }}>
      <HStack gap="space-8" align="center">
        {!showLogs ? (
          <Button
            variant="tertiary"
            size="xsmall"
            onClick={() => {
              setShowLogs(true)
              ensureLogsLoaded()
            }}
          >
            Vis logg
          </Button>
        ) : (
          <Button variant="tertiary" size="xsmall" onClick={() => setShowLogs(false)}>
            Skjul logg
          </Button>
        )}
        <Button
          variant="tertiary"
          size="xsmall"
          icon={<DownloadIcon aria-hidden />}
          onClick={downloadLogs}
          loading={pendingDownload && fetcher.state === 'loading'}
        >
          Last ned
        </Button>
      </HStack>
      {showLogs && (
        <>
          {fetcher.state === 'loading' && <Loader size="small" />}
          {fetcher.data?.error && (
            <Alert variant={fetcher.data.errorType === 'not_found' ? 'info' : 'warning'} size="small">
              {fetcher.data.error}
            </Alert>
          )}
          {fetcher.data?.logs && (
            <Box
              background="sunken"
              padding="space-8"
              borderRadius="4"
              style={{ maxHeight: '400px', overflow: 'auto' }}
            >
              <pre style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {fetcher.data.logs}
              </pre>
            </Box>
          )}
        </>
      )}
    </VStack>
  )
}
