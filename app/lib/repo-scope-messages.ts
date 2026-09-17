import type { AffectedApp } from '~/db/repositories.server'

export function repoAffectedAppsMessage(affectedApps: AffectedApp[], changedKeys: string[]): string {
  if (changedKeys.length === 0) return ''
  if (affectedApps.length === 0) return ''
  const listed = affectedApps.map((app) => `${app.team_slug}/${app.app_name} (${app.environment_name})`).join(', ')
  return ` Endringen gjelder ${affectedApps.length} ${affectedApps.length === 1 ? 'app' : 'apper'} i dette repoet: ${listed}.`
}
