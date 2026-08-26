import { SyncJobDetailView } from '~/components/SyncJobDetailView'
import { getSyncJobById, getSyncJobLogs, SYNC_JOB_STATUS_LABELS, SYNC_JOB_TYPE_LABELS } from '~/db/sync-jobs.server'
import { requireAppAdminAccess } from '~/lib/authorization.server'
import type { Route } from './+types/$team.env.$env.app.$app.admin.sync-job.$jobId'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.job ? `Jobb #${data.job.id}` : 'Jobb' }]
}

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { jobId: jobIdParam } = params
  const jobId = Number.parseInt(jobIdParam, 10)

  if (!Number.isFinite(jobId)) {
    throw new Response('Invalid job ID', { status: 400 })
  }

  const { app } = await requireAppAdminAccess(request, params)

  const job = await getSyncJobById(jobId)
  if (!job || job.monitored_app_id !== app.id) {
    throw new Response('Not found', { status: 404 })
  }

  const afterIdParam = Number.parseInt(url.searchParams.get('afterId') || '0', 10)
  const afterId = Number.isFinite(afterIdParam) ? afterIdParam : 0
  const logs = await getSyncJobLogs(jobId, { afterId })

  return {
    job,
    logs,
    jobTypeLabel: SYNC_JOB_TYPE_LABELS[job.job_type] || job.job_type,
    jobStatusLabel: SYNC_JOB_STATUS_LABELS[job.status] || job.status,
    hasDebugLogs: logs.some((l) => l.level === 'debug'),
  }
}

export default function SyncJobDetail({ loaderData }: Route.ComponentProps) {
  return <SyncJobDetailView {...loaderData} />
}
