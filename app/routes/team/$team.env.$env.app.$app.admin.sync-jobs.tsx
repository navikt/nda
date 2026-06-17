import { BodyShort, Box, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { SYNC_JOB_STATUS_LABELS, SYNC_JOB_TYPE_LABELS, type SyncJob, type SyncJobStatus } from '~/db/sync-job-types'
import { getSyncJobsForApp } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/$team.env.$env.app.$app.admin.sync-jobs'

export function meta() {
  return [{ title: 'Synk-jobber' }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)

  const app = await getMonitoredApplicationByIdentity(params.team, params.env, params.app)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const jobs = await getSyncJobsForApp(app.id, { limit: 200 })

  return { app, jobs }
}

function statusColor(status: SyncJobStatus): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'info'
    case 'failed':
      return 'danger'
    case 'cancelled':
      return 'warning'
    default:
      return 'neutral'
  }
}

function formatDuration(job: SyncJob): string {
  if (!job.started_at || !job.completed_at) return '—'
  const ms = new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.floor((ms % 60_000) / 1000)} s`
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function AppSyncJobsPage({ loaderData }: Route.ComponentProps) {
  const { app, jobs } = loaderData
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`
  const adminUrl = `${appUrl}/admin`

  const naisJobs = jobs.filter((j) => j.job_type === 'nais_sync')
  const verifyJobs = jobs.filter((j) => j.job_type === 'github_verify')
  const otherJobs = jobs.filter((j) => j.job_type !== 'nais_sync' && j.job_type !== 'github_verify')

  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="medium" spacing>
          Synk-jobber
        </Heading>
        <BodyShort textColor="subtle">
          Siste {jobs.length} synk-jobber for {app.app_name} i {app.environment_name}. Klikk på en jobb for å se
          detaljer og logger.
        </BodyShort>
      </div>

      <SyncJobTable title="NAIS Sync" description="Henter nye deployments fra NAIS." jobs={naisJobs} appUrl={appUrl} />

      <SyncJobTable
        title="GitHub Verifisering"
        description="Verifiserer fire-øyne-prinsippet mot GitHub PR-data."
        jobs={verifyJobs}
        appUrl={appUrl}
      />

      {otherJobs.length > 0 && (
        <SyncJobTable title="Andre jobber" description="Øvrige synk-jobber." jobs={otherJobs} appUrl={appUrl} />
      )}

      <BodyShort size="small" textColor="subtle">
        <Link to={adminUrl}>← Tilbake til admin</Link>
      </BodyShort>
    </VStack>
  )
}

function SyncJobTable({
  title,
  description,
  jobs,
  appUrl,
}: {
  title: string
  description: string
  jobs: SyncJob[]
  appUrl: string
}) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2" spacing>
            {title}
          </Heading>
          <BodyShort size="small" textColor="subtle">
            {description}
          </BodyShort>
        </div>

        {jobs.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen jobber funnet.
          </BodyShort>
        ) : (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Startet</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Varighet</Table.HeaderCell>
                <Table.HeaderCell>Resultat</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {jobs.map((job) => (
                <Table.Row key={job.id}>
                  <Table.DataCell>
                    <Link to={`${appUrl}/admin/sync-job/${job.id}`}>{formatTimestamp(job.started_at)}</Link>
                  </Table.DataCell>
                  <Table.DataCell>{SYNC_JOB_TYPE_LABELS[job.job_type] ?? job.job_type}</Table.DataCell>
                  <Table.DataCell>
                    <Tag data-color={statusColor(job.status)} variant="outline" size="xsmall">
                      {SYNC_JOB_STATUS_LABELS[job.status] ?? job.status}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>{formatDuration(job)}</Table.DataCell>
                  <Table.DataCell>
                    <ResultSummary job={job} />
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </VStack>
    </Box>
  )
}

function ResultSummary({ job }: { job: SyncJob }) {
  if (job.error) {
    return (
      <BodyShort size="small" textColor="subtle" title={job.error}>
        {job.error.length > 60 ? `${job.error.substring(0, 60)}…` : job.error}
      </BodyShort>
    )
  }

  if (!job.result) return <span>—</span>

  const r = job.result as Record<string, unknown>

  const parts: string[] = []
  if (typeof r.newCount === 'number') parts.push(`${r.newCount} nye`)
  if (typeof r.verified === 'number') parts.push(`${r.verified} verifisert`)
  if (typeof r.failed === 'number' && r.failed > 0) parts.push(`${r.failed} feilet`)
  if (typeof r.skipped === 'number' && r.skipped > 0) parts.push(`${r.skipped} hoppet over`)

  if (parts.length === 0) return <span>—</span>

  return (
    <HStack gap="space-8">
      {parts.map((p) => (
        <BodyShort key={p} size="small" textColor="subtle">
          {p}
        </BodyShort>
      ))}
    </HStack>
  )
}
