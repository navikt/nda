import type { AffectedApp } from '~/db/repositories.server'

export const REPO_NOT_LINKED_SUFFIX =
  ' Repoet er ikke koblet til en GitHub-repo-ID ennå, så innstillingen er foreløpig kun lagret for denne appen.'

export function affectedAppsMessage(affectedApps: AffectedApp[], actingAppId: number, changedKeys: string[]): string {
  if (changedKeys.length === 0) return ''
  const others = affectedApps.filter((app) => app.id !== actingAppId)
  if (others.length === 0) return ''
  const listed = others.map((app) => `${app.team_slug}/${app.app_name} (${app.environment_name})`).join(', ')
  return ` Endringen gjelder også ${others.length} ${others.length === 1 ? 'annen app' : 'andre apper'} i samme repo: ${listed}.`
}
