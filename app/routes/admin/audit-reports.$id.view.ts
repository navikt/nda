import { getAuditReportById, getAuditReportFile } from '~/db/audit-reports.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/audit-reports.$id.view'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)

  const reportId = Number(params.id)

  if (!reportId) {
    throw new Response('Ugyldig rapport-ID', { status: 400 })
  }

  const report = await getAuditReportById(reportId)

  if (!report) {
    throw new Response('Rapport ikke funnet', { status: 404 })
  }

  const pdfData = await getAuditReportFile(reportId, 'pdf')

  if (!pdfData) {
    throw new Response('PDF ikke generert ennå. Generer rapporten på nytt.', { status: 404 })
  }

  return new Response(pdfData as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${report.report_id}.pdf"`,
    },
  })
}
