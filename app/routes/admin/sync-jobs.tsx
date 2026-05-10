import {
  ArrowsCirclepathIcon,
  CheckmarkCircleIcon,
  ClockIcon,
  ExclamationmarkTriangleIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  Hide,
  HStack,
  Select,
  Show,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Form, Link, useSearchParams } from 'react-router'
import { SYNC_JOB_TYPE_LABELS } from '~/db/sync-job-types'
import {
  cleanupOldSyncJobs,
  getAllSyncJobs,
  getSyncJobAppNames,
  getSyncJobStats,
  releaseExpiredLocks,
  type SyncJobStatus,
  type SyncJobType,
} from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/sync-jobs'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Sync Jobs - Admin - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const status = url.searchParams.get('status') as SyncJobStatus | null
  const jobType = url.searchParams.get('type') as SyncJobType | null
  const appName = url.searchParams.get('app') || null

  const [jobs, stats, appNames] = await Promise.all([
    getAllSyncJobs({
      status: status || undefined,
      jobType: jobType || undefined,
      appName: appName || undefined,
      limit: 100,
    }),
    getSyncJobStats(),
    getSyncJobAppNames(),
  ])

  return { jobs, stats, appNames, filters: { status, jobType, appName } }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'release-expired') {
    const released = await releaseExpiredLocks()
    return { success: `Frigjorde ${released} utløpte låser`, error: null }
  }

  if (intent === 'cleanup') {
    const cleaned = await cleanupOldSyncJobs(50)
    return { success: `Slettet ${cleaned} gamle jobber`, error: null }
  }

  return { success: null, error: 'Ukjent handling' }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr) return '-'
  const start = new Date(startStr)
  const end = endStr ? new Date(endStr) : new Date()
  const durationMs = end.getTime() - start.getTime()
  const seconds = Math.floor(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function StatusTag({ status }: { status: SyncJobStatus }) {
  switch (status) {
    case 'running':
      return (
        <Tag data-color="info" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <ArrowsCirclepathIcon aria-hidden />
            Kjører
          </HStack>
        </Tag>
      )
    case 'completed':
      return (
        <Tag data-color="success" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <CheckmarkCircleIcon aria-hidden />
            Fullført
          </HStack>
        </Tag>
      )
    case 'failed':
      return (
        <Tag data-color="danger" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <XMarkOctagonIcon aria-hidden />
            Feilet
          </HStack>
        </Tag>
      )
    case 'pending':
      return (
        <Tag data-color="neutral" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <ClockIcon aria-hidden />
            Venter
          </HStack>
        </Tag>
      )
    case 'cancelled':
      return (
        <Tag data-color="warning" variant="moderate" size="small">
          <HStack gap="space-4" align="center">
            <ExclamationmarkTriangleIcon aria-hidden />
            Avbrutt
          </HStack>
        </Tag>
      )
  }
}

function JobTypeTag({ type }: { type: SyncJobType }) {
  return (
    <Tag data-color="accent" variant="outline" size="small">
      {SYNC_JOB_TYPE_LABELS[type] || type}
    </Tag>
  )
}

function StatCard({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string
  value: number
  color?: 'info' | 'success' | 'danger' | 'warning'
  active: boolean
  onClick: () => void
}) {
  const borderColor = color ? (`${color}-subtle` as const) : ('neutral-subtle' as const)
  return (
    <Box
      padding="space-16"
      borderRadius="8"
      background={active ? (color ? `${color}-softA` : 'neutral-softA') : 'raised'}
      borderColor={borderColor}
      borderWidth={active ? '2' : '1'}
      data-color={color}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <BodyShort size="small" textColor="subtle">
        {label}
      </BodyShort>
      <Heading level="3" size="large">
        {value}
      </Heading>
    </Box>
  )
}

export default function AdminSyncJobs({ loaderData, actionData }: Route.ComponentProps) {
  const { jobs, stats, appNames, filters } = loaderData
  const [, setSearchParams] = useSearchParams()

  function setStatusFilter(status: string | null) {
    setSearchParams((prev) => {
      if (status) {
        prev.set('status', status)
      } else {
        prev.delete('status')
      }
      return prev
    })
  }

  const activeStatus = filters.status

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Sync Jobs
        </Heading>
        <BodyShort textColor="subtle">Oversikt over synkroniseringsjobber og låser mellom podder.</BodyShort>
      </div>

      {actionData?.success && (
        <Alert variant="success" closeButton>
          {actionData.success}
        </Alert>
      )}

      {actionData?.error && (
        <Alert variant="error" closeButton>
          {actionData.error}
        </Alert>
      )}

      <HGrid gap="space-16" columns={{ xs: 2, md: 6 }}>
        <StatCard label="Totalt" value={stats.total} active={!activeStatus} onClick={() => setStatusFilter(null)} />
        <StatCard
          label="Kjører nå"
          value={stats.running}
          color="info"
          active={activeStatus === 'running'}
          onClick={() => setStatusFilter('running')}
        />
        <StatCard
          label="Fullført"
          value={stats.completed}
          color="success"
          active={activeStatus === 'completed'}
          onClick={() => setStatusFilter('completed')}
        />
        <StatCard
          label="Feilet"
          value={stats.failed}
          color="danger"
          active={activeStatus === 'failed'}
          onClick={() => setStatusFilter('failed')}
        />
        <StatCard
          label="Avbrutt"
          value={stats.cancelled}
          color="warning"
          active={activeStatus === 'cancelled'}
          onClick={() => setStatusFilter('cancelled')}
        />
        <StatCard label="Siste time" value={stats.lastHour} active={false} onClick={() => setStatusFilter(null)} />
      </HGrid>

      <HStack gap="space-16" justify="space-between" wrap>
        <Form method="get">
          <HStack gap="space-12">
            <Select label="Status" name="status" defaultValue={filters.status || ''} size="small">
              <option value="">Alle</option>
              <option value="running">Kjører</option>
              <option value="completed">Fullført</option>
              <option value="failed">Feilet</option>
              <option value="cancelled">Avbrutt</option>
              <option value="pending">Venter</option>
            </Select>
            <Select label="Type" name="type" defaultValue={filters.jobType || ''} size="small">
              <option value="">Alle</option>
              {Object.entries(SYNC_JOB_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select label="App" name="app" defaultValue={filters.appName || ''} size="small">
              <option value="">Alle</option>
              {appNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <Button type="submit" size="small" variant="secondary" style={{ alignSelf: 'flex-end' }}>
              Filtrer
            </Button>
          </HStack>
        </Form>

        <HStack gap="space-8">
          <Form method="post">
            <input type="hidden" name="intent" value="release-expired" />
            <Button type="submit" size="small" variant="tertiary">
              Frigjør utløpte låser
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="cleanup" />
            <Button type="submit" size="small" variant="tertiary">
              Rydd opp gamle jobber
            </Button>
          </Form>
        </HStack>
      </HStack>

      {jobs.length === 0 ? (
        <Alert variant="info">Ingen sync-jobber funnet med de valgte filtrene.</Alert>
      ) : (
        <div>
          {jobs.map((job) => (
            <Box
              key={job.id}
              padding="space-16"
              background="raised"
              className={styles.stackedListItem}
              as={Link}
              to={`/admin/sync-jobs/${job.id}`}
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              <VStack gap="space-12">
                {/* First row: ID, App name, Status/Type tags */}
                <HStack gap="space-8" align="center" justify="space-between" wrap>
                  <HStack gap="space-12" align="center" style={{ flex: 1 }}>
                    <Detail textColor="subtle">#{job.id}</Detail>
                    <BodyShort weight="semibold">{job.app_name ?? 'Global'}</BodyShort>
                    <Show above="md">
                      {job.team_slug && (
                        <Detail textColor="subtle">
                          {job.team_slug} / {job.environment_name}
                        </Detail>
                      )}
                    </Show>
                  </HStack>
                  <HStack gap="space-8">
                    <JobTypeTag type={job.job_type} />
                    <StatusTag status={job.status} />
                  </HStack>
                </HStack>

                {/* Team/env on mobile */}
                <Hide above="md">
                  {job.team_slug && (
                    <Detail textColor="subtle">
                      {job.team_slug} / {job.environment_name}
                    </Detail>
                  )}
                </Hide>

                {/* Second row: Details */}
                <HStack gap="space-16" wrap>
                  <Detail textColor="subtle">Startet: {formatDate(job.started_at)}</Detail>
                  <Detail textColor="subtle">Varighet: {formatDuration(job.started_at, job.completed_at)}</Detail>
                  {job.locked_by && <Detail textColor="subtle">Pod: {job.locked_by}</Detail>}
                  {job.options?.version && <Detail textColor="subtle">Versjon: {String(job.options.version)}</Detail>}
                </HStack>

                {/* Error/Result row */}
                {(job.error || job.result) && (
                  <BodyShort size="small" textColor="subtle" style={{ wordBreak: 'break-word' }}>
                    {job.error ? `❌ ${job.error}` : JSON.stringify(job.result)}
                  </BodyShort>
                )}
              </VStack>
            </Box>
          ))}
        </div>
      )}
    </VStack>
  )
}
