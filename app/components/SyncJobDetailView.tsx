import {
  Alert,
  BodyShort,
  Box,
  CopyButton,
  Detail,
  Heading,
  HStack,
  Loader,
  Switch,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useMemo, useState } from 'react'
import { useRevalidator } from 'react-router'
import type { SyncJob, SyncJobLog } from '~/db/sync-job-types'

interface SyncJobDetailViewProps {
  job: SyncJob
  logs: SyncJobLog[]
  jobTypeLabel: string
  jobStatusLabel: string
  hasDebugLogs: boolean
}

function LogLevelTag({ level }: { level: 'info' | 'warn' | 'error' | 'debug' }) {
  switch (level) {
    case 'error':
      return (
        <Tag variant="error" size="xsmall">
          FEIL
        </Tag>
      )
    case 'warn':
      return (
        <Tag variant="warning" size="xsmall">
          ADVARSEL
        </Tag>
      )
    case 'debug':
      return (
        <Tag variant="neutral" size="xsmall">
          DEBUG
        </Tag>
      )
    default:
      return (
        <Tag variant="info" size="xsmall">
          INFO
        </Tag>
      )
  }
}

function statusColor(status: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'warning'
    case 'running':
      return 'info'
    default:
      return 'neutral'
  }
}

export function SyncJobDetailView({ job, logs, jobTypeLabel, jobStatusLabel, hasDebugLogs }: SyncJobDetailViewProps) {
  const revalidator = useRevalidator()
  const [showDebug, setShowDebug] = useState(true)

  const isRunning = job.status === 'running'
  const progress = job.result as Record<string, number> | null
  const filteredLogs = showDebug ? logs : logs.filter((l) => l.level !== 'debug')

  const logsCopyText = useMemo(
    () =>
      filteredLogs
        .map((l) => {
          const time = new Date(l.created_at).toLocaleString('no-NO', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
          const details = l.details
            ? ` ${Object.entries(l.details)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')}`
            : ''
          return `${time} [${l.level.toUpperCase()}] ${l.message}${details}`
        })
        .join('\n'),
    [filteredLogs],
  )

  // Auto-poll for running jobs
  useEffect(() => {
    if (!isRunning) return

    const interval = setInterval(() => {
      revalidator.revalidate()
    }, 3000)

    return () => clearInterval(interval)
  }, [isRunning, revalidator])

  return (
    <VStack gap="space-24">
      {/* Header */}
      <VStack gap="space-8">
        <HStack gap="space-12" align="center">
          <Heading level="2" size="medium">
            Jobb #{job.id}
          </Heading>
          <Tag variant={statusColor(job.status)} size="small">
            {jobStatusLabel}
          </Tag>
          {isRunning && <Loader size="xsmall" />}
        </HStack>
        <BodyShort textColor="subtle" size="small">
          {jobTypeLabel}
        </BodyShort>
      </VStack>

      {/* Job info */}
      <Box padding="space-16" borderRadius="8" background="neutral-soft">
        <HStack gap="space-24" wrap>
          <div>
            <Detail textColor="subtle">Startet</Detail>
            <BodyShort size="small">
              {job.started_at ? new Date(job.started_at).toLocaleString('no-NO') : 'N/A'}
            </BodyShort>
          </div>
          {job.completed_at && (
            <div>
              <Detail textColor="subtle">Fullført</Detail>
              <BodyShort size="small">{new Date(job.completed_at).toLocaleString('no-NO')}</BodyShort>
            </div>
          )}
          {job.locked_by && (
            <div>
              <Detail textColor="subtle">Pod</Detail>
              <BodyShort size="small">{job.locked_by}</BodyShort>
            </div>
          )}
          {progress && (
            <>
              <div>
                <Detail textColor="subtle">Prosessert</Detail>
                <BodyShort size="small">
                  {progress.processed ?? 0} / {progress.total ?? 0}
                </BodyShort>
              </div>
              <div>
                <Detail textColor="subtle">Hentet</Detail>
                <BodyShort size="small">{progress.fetched ?? 0}</BodyShort>
              </div>
              <div>
                <Detail textColor="subtle">Hoppet over</Detail>
                <BodyShort size="small">{progress.skipped ?? 0}</BodyShort>
              </div>
              {(progress.errors ?? 0) > 0 && (
                <div>
                  <Detail textColor="subtle">Feil</Detail>
                  <BodyShort size="small" style={{ color: 'var(--ax-text-danger)' }}>
                    {progress.errors}
                  </BodyShort>
                </div>
              )}
            </>
          )}
        </HStack>
      </Box>

      {/* Error */}
      {job.error && (
        <Alert variant="error">
          <BodyShort size="small">{job.error}</BodyShort>
        </Alert>
      )}

      {/* Logs */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <HStack gap="space-12" align="center" justify="space-between">
            <Heading level="3" size="small">
              Logg ({filteredLogs.length} meldinger)
            </Heading>
            <HStack gap="space-12" align="center">
              {filteredLogs.length > 0 && (
                <CopyButton copyText={logsCopyText} size="small" text="Kopier logg" activeText="Kopiert!" />
              )}
              {hasDebugLogs && (
                <Switch size="small" checked={showDebug} onChange={() => setShowDebug(!showDebug)}>
                  Vis debug
                </Switch>
              )}
              {isRunning && (
                <HStack gap="space-8" align="center">
                  <Loader size="xsmall" />
                  <Detail textColor="subtle">Oppdateres automatisk</Detail>
                </HStack>
              )}
            </HStack>
          </HStack>

          {filteredLogs.length === 0 ? (
            <BodyShort textColor="subtle" size="small">
              Ingen loggmeldinger ennå.
            </BodyShort>
          ) : (
            <VStack gap="space-4">
              {filteredLogs.map((log) => (
                <Box
                  key={log.id}
                  padding="space-8"
                  borderRadius="4"
                  background={
                    log.level === 'error'
                      ? 'danger-softA'
                      : log.level === 'warn'
                        ? 'warning-softA'
                        : log.level === 'debug'
                          ? 'neutral-soft'
                          : 'neutral-softA'
                  }
                >
                  <HStack gap="space-8" align="start" wrap={false}>
                    <Detail textColor="subtle" style={{ whiteSpace: 'nowrap', minWidth: '140px' }}>
                      {new Date(log.created_at).toLocaleString('no-NO', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Detail>
                    <LogLevelTag level={log.level} />
                    <BodyShort size="small" style={{ flex: 1 }}>
                      {log.message}
                    </BodyShort>
                    {log.details && (
                      <Detail textColor="subtle" style={{ whiteSpace: 'nowrap' }}>
                        {Object.entries(log.details)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(' ')}
                      </Detail>
                    )}
                  </HStack>
                </Box>
              ))}
            </VStack>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
