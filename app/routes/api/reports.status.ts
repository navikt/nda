import { data } from 'react-router'
import { getReportJobStatus } from '~/db/report-jobs.server'
import { requireUser } from '~/lib/auth.server'
import { canAccessAppAdmin } from '~/lib/authorization.server'
import type { Route } from './+types/reports.status'

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUser(request)

  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return data({ error: 'Missing jobId' }, { status: 400 })
  }

  const job = await getReportJobStatus(jobId)

  if (!job) {
    return data({ error: 'Job not found' }, { status: 404 })
  }

  if (job.monitored_app_id == null || !(await canAccessAppAdmin(user, job.monitored_app_id))) {
    return data({ error: 'Forbidden - admin access required' }, { status: 403 })
  }

  return data({
    status: job.status,
    error: job.error,
    createdAt: job.created_at,
    completedAt: job.completed_at,
  })
}
