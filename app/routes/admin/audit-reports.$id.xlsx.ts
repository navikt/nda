import { getAuditReportById } from '~/db/audit-reports.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/audit-reports.$id.xlsx'

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

  if (!report.excel_data) {
    throw new Response('Excel ikke generert ennå. Generer rapporten på nytt.', { status: 404 })
  }

  return new Response(new Uint8Array(report.excel_data), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${report.report_id}.xlsx"`,
    },
  })
}
