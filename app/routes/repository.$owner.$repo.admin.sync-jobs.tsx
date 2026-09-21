import { BodyShort, Box, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { SYNC_JOB_STATUS_LABELS, SYNC_JOB_TYPE_LABELS, type SyncJob, type SyncJobStatus } from '~/db/sync-job-types'
import { getSyncJobsForRepository } from '~/db/sync-jobs.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo.admin.sync-jobs'

export function meta() {
  return [{ title: 'Synk-jobber' }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/admin/sync-jobs')

  const { authorized } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const jobs = await getSyncJobsForRepository(repository.id, { limit: 200 })

  return {
    repositoryContext: {
      id: repository.id,
      githubOwner: repository.github_owner,
      githubRepoName: repository.github_repo_name,
    },
    jobs,
  }
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
    case 'partial':
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

export default function RepositorySyncJobsPage({ loaderData }: Route.ComponentProps) {
  const { repositoryContext, jobs } = loaderData
  const repoUrl = `/repository/${repositoryContext.githubOwner}/${repositoryContext.githubRepoName}`
  const adminUrl = `${repoUrl}/admin`

  const fetchJobs = jobs.filter((j) => j.job_type === 'fetch_verification_data')
  const reverifyJobs = jobs.filter((j) => j.job_type === 'reverify_app')
  const otherJobs = jobs.filter((j) => j.job_type !== 'fetch_verification_data' && j.job_type !== 'reverify_app')

  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="medium" spacing>
          Synk-jobber
        </Heading>
        <BodyShort textColor="subtle">
          Siste {jobs.length} repo-scopede synk-jobber for {repositoryContext.githubOwner}/
          {repositoryContext.githubRepoName}. Klikk på en jobb for å se detaljer og logger.
        </BodyShort>
      </div>

      <SyncJobTable
        title="Hent verifiseringsdata"
        description="Henter deployment- og PR-data fra GitHub for repositoryet."
        jobs={fetchJobs}
        repoUrl={repoUrl}
        repositoryId={repositoryContext.id}
      />

      <SyncJobTable
        title="Reverifisering"
        description="Beregner verifiseringsavvik på nytt for alle apper knyttet til repositoryet."
        jobs={reverifyJobs}
        repoUrl={repoUrl}
        repositoryId={repositoryContext.id}
      />

      {otherJobs.length > 0 && (
        <SyncJobTable
          title="Andre jobber"
          description="Øvrige synk-jobber."
          jobs={otherJobs}
          repoUrl={repoUrl}
          repositoryId={repositoryContext.id}
        />
      )}

      <BodyShort size="small" textColor="subtle">
        <Link to={`${adminUrl}?repositoryId=${repositoryContext.id}`}>← Tilbake til admin</Link>
      </BodyShort>
    </VStack>
  )
}

function SyncJobTable({
  title,
  description,
  jobs,
  repoUrl,
  repositoryId,
}: {
  title: string
  description: string
  jobs: SyncJob[]
  repoUrl: string
  repositoryId: number
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
                    <Link to={`${repoUrl}/admin/sync-job/${job.id}?repositoryId=${repositoryId}`}>
                      {formatTimestamp(job.started_at)}
                    </Link>
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
  if (typeof r.verified === 'number') {
    const remainingSuffix = typeof r.remaining === 'number' && r.remaining > 0 ? ` (${r.remaining} gjenstår)` : ''
    parts.push(`${r.verified} verifisert${remainingSuffix}`)
  }
  if (typeof r.appsProcessed === 'number' && typeof r.appsTotal === 'number') {
    parts.push(`${r.appsProcessed}/${r.appsTotal} apper`)
  }
  if (typeof r.diffsFound === 'number') parts.push(`${r.diffsFound} avvik`)
  if (typeof r.fetched === 'number') parts.push(`${r.fetched} hentet`)
  if (typeof r.refreshed === 'number') parts.push(`${r.refreshed} oppdatert`)
  if (typeof r.processed === 'number' && typeof r.total === 'number') {
    parts.push(`${r.processed}/${r.total} prosessert`)
  }
  if (typeof r.failed === 'number' && r.failed > 0) parts.push(`${r.failed} feilet`)
  if (typeof r.skipped === 'number' && r.skipped > 0) parts.push(`${r.skipped} hoppet over`)
  if (typeof r.appsSkippedLocked === 'number' && r.appsSkippedLocked > 0) {
    parts.push(`${r.appsSkippedLocked} app(er) hoppet over pga. lås`)
  }
  if (typeof r.errors === 'number' && r.errors > 0) parts.push(`${r.errors} feil`)

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
