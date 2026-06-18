/**
 * API: Download an audit report
 *
 * Returns the PDF file for a report.
 * App-scoped for IDOR protection. Archived reports return 404. Superseded allowed.
 * Secured with M2M token validation.
 *
 * GET /api/v1/apps/:team/:env/:app/audit-reports/:reportId/download?format=pdf
 */

import { getAuditReportFile, getReportByReportIdForApp } from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { jsonError, validateProdEnvironment } from '~/lib/api/errors'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import type { Route } from './+types/v1.apps.$team.$env.$app.audit-reports.$reportId.download'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireM2MToken(request)

  const { team, env, app: appName, reportId } = params

  const envError = validateProdEnvironment(env)
  if (envError) throw envError

  const url = new URL(request.url)
  const format = url.searchParams.get('format') ?? 'pdf'

  if (format !== 'pdf') {
    throw jsonError(`Invalid format: ${format}. Only "pdf" is currently supported.`, 400)
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

  const pdfData = await getAuditReportFile(report.id, 'pdf')

  if (!pdfData) {
    throw jsonError('PDF not yet generated for this report', 404)
  }

  const pdfBuffer = Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData)
  const filename = `${report.report_id}.pdf`

  // Buffer extends Uint8Array; cast avoids TS BodyInit strictness without copying
  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBuffer.length),
    },
  })
}
