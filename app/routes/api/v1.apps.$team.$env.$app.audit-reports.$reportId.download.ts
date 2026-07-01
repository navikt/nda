import { getAuditReportFile, getReportByReportIdForApp } from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { jsonError, validateProdEnvironment } from '~/lib/api/errors'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import type { Route } from './+types/v1.apps.$team.$env.$app.audit-reports.$reportId.download'

export async function loader({ request, params, url }: Route.LoaderArgs) {
  await requireM2MToken(request)

  const { team, env, app: appName, reportId } = params

  const envError = validateProdEnvironment(env)
  if (envError) throw envError

  const format = url.searchParams.get('format') ?? 'pdf'

  if (format !== 'pdf' && format !== 'xlsx') {
    throw jsonError(`Invalid format: ${format}. Supported formats: "pdf", "xlsx".`, 400)
  }

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!monitoredApp) {
    throw jsonError('Application not found', 404)
  }

  const report = await getReportByReportIdForApp(reportId, monitoredApp.id)
  if (!report) {
    throw jsonError('Report not found', 404)
  }

  if (report.archived_at) {
    throw jsonError('Report has been archived', 404)
  }

  if (format === 'xlsx') {
    const excelData = await getAuditReportFile(report.id, 'xlsx')
    if (!excelData) {
      throw jsonError('Excel not yet generated for this report', 404)
    }
    const filename = `${report.report_id}.xlsx`
    return new Response(excelData as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(excelData.length),
      },
    })
  }

  const pdfData = await getAuditReportFile(report.id, 'pdf')

  if (!pdfData) {
    throw jsonError('PDF not yet generated for this report', 404)
  }

  const filename = `${report.report_id}.pdf`

  return new Response(pdfData as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfData.length),
    },
  })
}
