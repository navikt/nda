import { data } from 'react-router'
import { getReportJobWithPdf } from '~/db/report-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/reports.download'

export async function loader({ request, url }: Route.LoaderArgs) {
  await requireAdmin(request)

  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return data({ error: 'Missing jobId' }, { status: 400 })
  }

  const job = await getReportJobWithPdf(jobId)

  if (!job) {
    return data({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'completed') {
    return data({ error: 'Report not ready' }, { status: 400 })
  }

  if (!job.pdf_data) {
    return data({ error: 'PDF data not found' }, { status: 500 })
  }

  const filename = `${job.app_name}-rapport-${job.year}.pdf`

  return new Response(new Uint8Array(job.pdf_data), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
