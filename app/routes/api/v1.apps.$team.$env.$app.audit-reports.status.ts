import { getActiveReportsForPeriodM2M } from '~/db/audit-reports.server'
import { getAppChangeOriginCoverage, getAppDeploymentStats } from '~/db/deployments.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { buildAppMetadata } from '~/lib/api/app-metadata.server'
import { jsonError, validateProdEnvironment } from '~/lib/api/errors'
import { toReportSummaryM2M } from '~/lib/api/report-formatters'
import type { AuditReportStatusResponse } from '~/lib/api/types'
import { parseLocalDate, toDateString } from '~/lib/date-utils'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import { isValidReportPeriodType, type ReportPeriodType, resolvePeriod } from '~/lib/report-periods'
import type { Route } from './+types/v1.apps.$team.$env.$app.audit-reports.status'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireM2MToken(request)

  const { team, env, app: appName } = params

  const envError = validateProdEnvironment(env)
  if (envError) throw envError

  const url = new URL(request.url)
  const periodType = url.searchParams.get('periodType')
  const periodStartParam = url.searchParams.get('periodStart')

  if (!periodType || !periodStartParam) {
    throw jsonError('Missing required parameters: periodType and periodStart', 400)
  }

  if (!isValidReportPeriodType(periodType)) {
    throw jsonError(`Invalid periodType: ${periodType}. Valid values: yearly, tertiary, quarterly, monthly`, 400)
  }

  let periodStartDate: Date
  try {
    periodStartDate = parseLocalDate(periodStartParam)
  } catch {
    throw jsonError('Invalid periodStart. Use format YYYY-MM-DD', 400)
  }

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!monitoredApp) {
    throw jsonError('Application not found', 404)
  }

  const resolved = resolvePeriod(periodType as ReportPeriodType, periodStartDate, monitoredApp.audit_start_year)
  if (resolved.error !== null) {
    throw jsonError(resolved.error, 400)
  }

  const period = resolved.period

  const [appMetadata, stats, changeOrigin, existingReports] = await Promise.all([
    buildAppMetadata(monitoredApp),
    getAppDeploymentStats(monitoredApp.id, period.startDate, period.endDate, monitoredApp.audit_start_year),
    getAppChangeOriginCoverage(monitoredApp.id, period.startDate, period.endDate, monitoredApp.audit_start_year),
    getActiveReportsForPeriodM2M(monitoredApp.id, period.type, period.startDate),
  ])

  const total = stats.total
  const approved = stats.with_four_eyes
  const pending = stats.pending_verification
  const notApproved = stats.without_four_eyes

  const response: AuditReportStatusResponse = {
    app: appMetadata,
    period: {
      type: period.type,
      label: period.label,
      start: toDateString(period.startDate),
      end: toDateString(period.endDate),
    },
    deployments: {
      total,
      approved,
      pending,
      notApproved,
      approvedPercent: total > 0 ? Math.round((approved / total) * 1000) / 10 : 0,
      withChangeOrigin: changeOrigin.linked,
      changeOriginPercent: changeOrigin.coveragePercent,
    },
    existingReports: existingReports.map(toReportSummaryM2M),
    availableFormats: ['pdf', 'xlsx'],
  }

  return Response.json(response)
}
