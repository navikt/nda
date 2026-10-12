export interface NaisHistoryRecoveryCandidate {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  initial_nais_history_synced_at: Date
  latest_sync_status: string | null
  latest_sync_started_at: Date | null
  latest_sync_version: string | null
  latest_sync_is_active: boolean
}

export interface NaisSyncWindowApp {
  app_id: number
  team_slug: string
  environment_name: string
  app_name: string
  initial_nais_history_synced_at: Date | null
  completed_syncs: number
  failed_syncs: number
  last_completed_at: Date | null
  last_error: string | null
  id_collision: boolean
  marker_without_completed_job: boolean
  deployment_count: number
}

export function getNaisSyncWindowRisks(app: NaisSyncWindowApp): string[] {
  const risks: string[] = []
  if (app.marker_without_completed_job) risks.push('Markør satt uten fullført synkjobb')
  if (app.id_collision) risks.push('Kollisjon på deployment-ID mellom applikasjoner')
  if (app.failed_syncs > 0 && !app.id_collision) risks.push('Feilet synk i tidsrommet')
  if (!app.initial_nais_history_synced_at) risks.push('Venter på full historikksynk')
  if (app.deployment_count === 0) risks.push('Ingen leveranser lagret')
  return risks
}
