import { SyncJobDetailView } from '~/components/SyncJobDetailView'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getSyncJobById, getSyncJobLogs, SYNC_JOB_STATUS_LABELS, SYNC_JOB_TYPE_LABELS } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/$team.env.$env.app.$app.admin.sync-job.$jobId'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.job ? `Jobb #${data.job.id}` : 'Jobb' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { team, env, app: appName, jobId: jobIdParam } = params
  const jobId = parseInt(jobIdParam, 10)

  const [app, job] = await Promise.all([getMonitoredApplicationByIdentity(team, env, appName), getSyncJobById(jobId)])

  if (!app || !job) {
    throw new Response('Not found', { status: 404 })
  }

  const url = new URL(request.url)
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

export default function SyncJobDetail({ loaderData }: Route.ComponentProps) {
  return <SyncJobDetailView {...loaderData} />
}
