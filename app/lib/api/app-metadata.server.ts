import { getMonorepoSiblings } from '~/db/monorepo.server'
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

  const monorepo = await getMonorepoSiblings(app.id)
  if (monorepo) {
    const allApps = [
      { team: app.team_slug, environment: app.environment_name, name: app.app_name },
      ...monorepo.siblings.map((a) => ({
        team: a.team_slug,
        environment: a.environment_name,
        name: a.app_name,
      })),
    ].sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.environment.localeCompare(b.environment) || a.team.localeCompare(b.team),
    )

    applicationGroup = {
      name: `${monorepo.github_owner}/${monorepo.github_repo_name}`,
      apps: allApps,
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
