import { data } from 'react-router'
import { getReportJobStatus } from '~/db/report-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/reports.status'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return data({ error: 'Missing jobId' }, { status: 400 })
  }

  const job = await getReportJobStatus(jobId)

  if (!job) {
    return data({ error: 'Job not found' }, { status: 404 })
  }

  return data({
    status: job.status,
    error: job.error,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    downloadUrl: job.status === 'completed' ? `/api/reports/download?jobId=${jobId}` : null,
  })
}
