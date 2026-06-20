import { getActiveReportsForAppM2M } from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { buildAppMetadata } from '~/lib/api/app-metadata.server'
import { jsonError, validateProdEnvironment } from '~/lib/api/errors'
import { toReportSummaryM2M } from '~/lib/api/report-formatters'
import type { AuditReportListResponse } from '~/lib/api/types'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import type { Route } from './+types/v1.apps.$team.$env.$app.audit-reports'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireM2MToken(request)

  const { team, env, app: appName } = params

  const envError = validateProdEnvironment(env)
  if (envError) throw envError

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!monitoredApp) {
    throw jsonError('Application not found', 404)
  }

  const [appMetadata, reports] = await Promise.all([
    buildAppMetadata(monitoredApp),
    getActiveReportsForAppM2M(monitoredApp.id),
  ])

  const response: AuditReportListResponse = {
    app: appMetadata,
    reports: reports.map(toReportSummaryM2M),
  }

  return Response.json(response)
}
