import { SyncJobDetailView } from '~/components/SyncJobDetailView'
import { getSyncJobById, getSyncJobLogs, SYNC_JOB_STATUS_LABELS, SYNC_JOB_TYPE_LABELS } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/sync-jobs.$jobId'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.job ? `Jobb #${data.job.id} - Sync Jobs` : 'Jobb' }]
}

export async function loader({ params, request, url }: Route.LoaderArgs) {
  await requireAdmin(request)

  const jobId = parseInt(params.jobId, 10)
  const job = await getSyncJobById(jobId)

  if (!job) {
    throw new Response('Not found', { status: 404 })
  }

  const afterId = parseInt(url.searchParams.get('afterId') || '0', 10)
  const logs = await getSyncJobLogs(jobId, { afterId })

  return {
    job,
    logs,
    jobTypeLabel: SYNC_JOB_TYPE_LABELS[job.job_type] || job.job_type,
    jobStatusLabel: SYNC_JOB_STATUS_LABELS[job.status] || job.status,
    hasDebugLogs: logs.some((l) => l.level === 'debug'),
  }
}

export default function AdminSyncJobDetail({ loaderData }: Route.ComponentProps) {
  return <SyncJobDetailView {...loaderData} />
}
