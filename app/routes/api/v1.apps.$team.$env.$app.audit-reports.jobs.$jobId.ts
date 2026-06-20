import { getReportSummaryById } from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getReportJobStatusForApp } from '~/db/report-jobs.server'
import { buildAppMetadata } from '~/lib/api/app-metadata.server'
import { jsonError, validateProdEnvironment } from '~/lib/api/errors'
import { toReportSummaryM2M } from '~/lib/api/report-formatters'
import type { AuditReportJobStatusResponse } from '~/lib/api/types'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import type { Route } from './+types/v1.apps.$team.$env.$app.audit-reports.jobs.$jobId'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireM2MToken(request)

  const { team, env, app: appName, jobId } = params

  const envError = validateProdEnvironment(env)
  if (envError) throw envError

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!monitoredApp) {
    throw jsonError('Application not found', 404)
  }

  const job = await getReportJobStatusForApp(jobId, monitoredApp.id)
  if (!job) {
    throw jsonError('Job not found', 404)
  }

  const appMetadata = await buildAppMetadata(monitoredApp)

  let reportId: string | null = null
  let report: AuditReportJobStatusResponse['report'] = null

  if (job.status === 'completed' && job.audit_report_id) {
    const reportRow = await getReportSummaryById(job.audit_report_id)
    if (reportRow) {
      reportId = reportRow.report_id
      const full = toReportSummaryM2M(reportRow)
      report = {
        reportId: full.reportId,
        generatedAt: full.generatedAt,
        generatedBy: full.generatedBy,
        totalDeployments: full.totalDeployments,
        approvedCount: full.approvedCount,
        withChangeOriginCount: full.withChangeOriginCount,
        contentHash: full.contentHash,
        availableFormats: full.availableFormats,
      }
    }
  }

  const response: AuditReportJobStatusResponse = {
    app: appMetadata,
    jobId: job.job_id,
    status: job.status as AuditReportJobStatusResponse['status'],
    createdAt: new Date(job.created_at).toISOString(),
    completedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null,
    error: job.error,
    reportId,
    report,
  }

  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (job.status === 'pending' || job.status === 'processing') {
    headers['Retry-After'] = '10'
  }

  return new Response(JSON.stringify(response), { headers })
}
