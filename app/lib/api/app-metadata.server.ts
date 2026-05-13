/**
 * Build AppMetadata for M2M API responses.
 *
 * Combines monitored application data with application group info
 * into the standardized shape used by all audit report API endpoints.
 */

import { getGroupByAppId, getGroupWithApps } from '~/db/application-groups.server'
import type { AuditReportAppMetadata } from '~/lib/api/types'

interface MonitoredApp {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  audit_start_year: number | null
}

export async function buildAppMetadata(app: MonitoredApp): Promise<AuditReportAppMetadata> {
  let applicationGroup: AuditReportAppMetadata['applicationGroup'] = null

  const group = await getGroupByAppId(app.id)
  if (group) {
    const groupWithApps = await getGroupWithApps(group.id)
    if (groupWithApps) {
      applicationGroup = {
        name: groupWithApps.name,
        apps: groupWithApps.apps.map((a) => ({
          team: a.team_slug,
          environment: a.environment_name,
          name: a.app_name,
        })),
      }
    }
  }

  return {
    team: app.team_slug,
    environment: app.environment_name,
    name: app.app_name,
    auditStartDate: app.audit_start_year ? `${app.audit_start_year}-01-01` : null,
    applicationGroup,
  }
}
