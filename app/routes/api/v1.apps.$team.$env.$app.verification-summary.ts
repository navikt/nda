/**
 * API: Verification Summary for an Application
 *
 * Returns four-eyes coverage and change origin (endringsopphav) data
 * for a monitored application. Secured with M2M token validation.
 *
 * GET /api/v1/apps/:team/:env/:app/verification-summary
 *
 * Query parameters:
 *   from - ISO 8601 date (default: start of current year)
 *   to   - ISO 8601 date (default: now)
 */

import { getAppChangeOriginCoverage, getAppDeploymentStats, getLastDeploymentSummary } from '~/db/deployments.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import type { VerificationSummaryResponse } from '~/lib/api/types'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import type { Route } from './+types/v1.apps.$team.$env.$app.verification-summary'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireM2MToken(request)

  const { team, env, app: appName } = params

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!monitoredApp) {
    throw new Response(JSON.stringify({ error: 'Application not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from') as string) : startOfYear
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to') as string) : now

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Response(JSON.stringify({ error: 'Invalid date format. Use ISO 8601.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (from > to) {
    throw new Response(JSON.stringify({ error: 'Invalid date range: "from" must be before "to".' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const [stats, changeOrigin, lastDeployment] = await Promise.all([
    getAppDeploymentStats(monitoredApp.id, from, to, monitoredApp.audit_start_year),
    getAppChangeOriginCoverage(monitoredApp.id, from, to, monitoredApp.audit_start_year),
    getLastDeploymentSummary(monitoredApp.id),
  ])

  const response: VerificationSummaryResponse = {
    app: {
      team: monitoredApp.team_slug,
      environment: monitoredApp.environment_name,
      name: monitoredApp.app_name,
      isActive: monitoredApp.is_active,
    },
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    fourEyesCoverage: {
      total: stats.total,
      approved: stats.with_four_eyes,
      unapproved: stats.without_four_eyes,
      pending: stats.pending_verification,
      coveragePercent: stats.four_eyes_percentage,
    },
    changeOriginCoverage: changeOrigin,
    lastDeployment: lastDeployment
      ? {
          createdAt: lastDeployment.createdAt.toISOString(),
          deployer: lastDeployment.deployer,
          commitSha: lastDeployment.commitSha,
          fourEyesStatus: lastDeployment.fourEyesStatus,
          hasChangeOrigin: lastDeployment.hasChangeOrigin,
        }
      : null,
  }

  return Response.json(response)
}
